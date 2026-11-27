import type { APIRoute } from 'astro';
import { getActaSyncSecret, getDb } from '../../lib/runtime';
import { getAdminMatch, getTeamPlayers, recomputeStandings } from '../../lib/db';

export const prerender = false;

interface ActaPlayerPayload {
	number: string | number;
	name: string;
	points: number;
	fg2: number;
	fg3: number;
	ftm: number;
	fta: number;
	fouls: number;
	played?: boolean;
}

interface QuarterPayload {
	q1?: number | null;
	q2?: number | null;
	q3?: number | null;
	q4?: number | null;
	ot1?: number | null;
	ot2?: number | null;
	ot3?: number | null;
}

interface ActaSyncPayload {
	matchId?: number | null;
	week?: number | null;
	homeTeam?: string;
	awayTeam?: string;
	mode: 'live' | 'final';
	actaGameId?: string;
	homeScore: number;
	awayScore: number;
	period?: number;
	clockMs?: number;
	shotSec?: number | null;
	quarters?: {
		home?: QuarterPayload;
		away?: QuarterPayload;
	};
	players?: {
		home?: ActaPlayerPayload[];
		away?: ActaPlayerPayload[];
		meta?: Record<string, unknown>;
	};
	pbp?: unknown[];
	observations?: string | null;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
}

function normalizeName(name: string): string {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

async function resolvePlayerId(
	teamId: number,
	p: ActaPlayerPayload,
	existing: { id: number; name: string; number: string | null }[],
): Promise<number> {
	const numStr = String(p.number ?? '').trim();
	const normName = normalizeName(p.name || '');

	// 1. Match by normalized name
	if (normName) {
		const byName = existing.find((e) => normalizeName(e.name) === normName);
		if (byName) return byName.id;
	}
	// 2. Match by dorsal number
	if (numStr) {
		const byNum = existing.find((e) => (e.number ?? '').trim() === numStr);
		if (byNum) return byNum.id;
	}

	// 3. Auto-create missing player so stats are never lost
	const cleanName = (p.name || `Jugador #${numStr || '?'}`).trim();
	await getDb()
		.prepare('INSERT OR IGNORE INTO players (team_id, name, number) VALUES (?, ?, ?)')
		.bind(teamId, cleanName, numStr || null)
		.run();

	const created = (await getDb()
		.prepare('SELECT id FROM players WHERE team_id = ? AND name = ? LIMIT 1')
		.bind(teamId, cleanName)
		.first()) as { id: number } | null;

	if (!created) {
		throw new Error(`No se pudo crear el jugador ${cleanName}`);
	}
	existing.push({ id: created.id, name: cleanName, number: numStr || null });
	return created.id;
}

async function resolveMatchId(body: ActaSyncPayload): Promise<number | null> {
	const explicitId = Number(body.matchId);
	if (Number.isInteger(explicitId) && explicitId > 0) {
		return explicitId;
	}

	const normHome = normalizeName(body.homeTeam || '');
	const normAway = normalizeName(body.awayTeam || '');
	if (!normHome || !normAway) return null;

	const teamsRes = await getDb().prepare('SELECT id, name, short_name FROM teams').all();
	const teams = teamsRes.results as { id: number; name: string; short_name: string }[];
	const findTeamId = (norm: string) =>
		teams.find((t) => normalizeName(t.name) === norm || normalizeName(t.short_name) === norm)?.id ?? null;

	const homeId = findTeamId(normHome);
	const awayId = findTeamId(normAway);
	if (!homeId || !awayId) return null;

	const week = Number(body.week);
	if (Number.isInteger(week) && week > 0) {
		const exact = (await getDb()
			.prepare('SELECT id FROM matches WHERE week = ? AND home_team_id = ? AND away_team_id = ? LIMIT 1')
			.bind(week, homeId, awayId)
			.first()) as { id: number } | null;
		if (exact) return exact.id;
	}

	const nextScheduled = (await getDb()
		.prepare(
			"SELECT id FROM matches WHERE home_team_id = ? AND away_team_id = ? AND status = 'scheduled' ORDER BY week ASC LIMIT 1",
		)
		.bind(homeId, awayId)
		.first()) as { id: number } | null;
	if (nextScheduled) return nextScheduled.id;

	const anyMatch = (await getDb()
		.prepare('SELECT id FROM matches WHERE home_team_id = ? AND away_team_id = ? ORDER BY week ASC LIMIT 1')
		.bind(homeId, awayId)
		.first()) as { id: number } | null;
	return anyMatch?.id ?? null;
}

export const POST: APIRoute = async ({ request }) => {
	const secret = getActaSyncSecret();
	const headerSecret =
		request.headers.get('x-acta-secret') ||
		(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

	if (secret && headerSecret !== secret) {
		return json({ error: 'No autorizado' }, 401);
	}

	let body: ActaSyncPayload;
	try {
		body = (await request.json()) as ActaSyncPayload;
	} catch {
		return json({ error: 'JSON inválido' }, 400);
	}

	const matchId = await resolveMatchId(body);
	if (!matchId) {
		return json({ error: 'No se pudo emparejar el partido (revisa jornada y equipos)' }, 404);
	}

	const match = await getAdminMatch(matchId);
	if (!match) {
		return json({ error: 'Partido no encontrado' }, 404);
	}

	const homeScore = Math.max(0, Math.round(Number(body.homeScore) || 0));
	const awayScore = Math.max(0, Math.round(Number(body.awayScore) || 0));
	const hq = body.quarters?.home ?? {};
	const aq = body.quarters?.away ?? {};

	if (body.mode === 'live') {
		await getDb()
			.prepare(
				`INSERT INTO live_matches (
					match_id, home_score, away_score, period, clock_ms, shot_sec,
					home_q1, home_q2, home_q3, home_q4,
					away_q1, away_q2, away_q3, away_q4,
					home_ot1, home_ot2, home_ot3,
					away_ot1, away_ot2, away_ot3,
					pbp_json, stats_json, acta_game_id, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
				ON CONFLICT(match_id) DO UPDATE SET
					home_score = excluded.home_score,
					away_score = excluded.away_score,
					period = excluded.period,
					clock_ms = excluded.clock_ms,
					shot_sec = excluded.shot_sec,
					home_q1 = excluded.home_q1, home_q2 = excluded.home_q2, home_q3 = excluded.home_q3, home_q4 = excluded.home_q4,
					away_q1 = excluded.away_q1, away_q2 = excluded.away_q2, away_q3 = excluded.away_q3, away_q4 = excluded.away_q4,
					home_ot1 = excluded.home_ot1, home_ot2 = excluded.home_ot2, home_ot3 = excluded.home_ot3,
					away_ot1 = excluded.away_ot1, away_ot2 = excluded.away_ot2, away_ot3 = excluded.away_ot3,
					pbp_json = excluded.pbp_json,
					stats_json = excluded.stats_json,
					acta_game_id = excluded.acta_game_id,
					updated_at = datetime('now')`,
			)
			.bind(
				matchId,
				homeScore,
				awayScore,
				Math.max(1, Math.round(Number(body.period) || 1)),
				Math.max(0, Math.round(Number(body.clockMs) || 0)),
				body.shotSec ?? null,
				hq.q1 ?? null,
				hq.q2 ?? null,
				hq.q3 ?? null,
				hq.q4 ?? null,
				aq.q1 ?? null,
				aq.q2 ?? null,
				aq.q3 ?? null,
				aq.q4 ?? null,
				hq.ot1 ?? null,
				hq.ot2 ?? null,
				hq.ot3 ?? null,
				aq.ot1 ?? null,
				aq.ot2 ?? null,
				aq.ot3 ?? null,
				body.pbp ? JSON.stringify(body.pbp.slice(0, 200)) : null,
				body.players ? JSON.stringify(body.players) : null,
				body.actaGameId ?? null,
			)
			.run();

		return json({ ok: true, mode: 'live', matchId, homeScore, awayScore });
	}

	if (body.mode === 'final') {
		const [homeExisting, awayExisting] = await Promise.all([
			getTeamPlayers(match.home_id),
			getTeamPlayers(match.away_id),
		]);

		const statements = [
			getDb()
				.prepare(
					`UPDATE matches SET
						status = 'finished',
						forfeit_team_id = NULL,
						home_score = ?, away_score = ?,
						home_q1 = ?, home_q2 = ?, home_q3 = ?, home_q4 = ?,
						away_q1 = ?, away_q2 = ?, away_q3 = ?, away_q4 = ?,
						home_ot1 = ?, home_ot2 = ?, home_ot3 = ?,
						away_ot1 = ?, away_ot2 = ?, away_ot3 = ?,
						observations = ?, pbp_json = ?
					 WHERE id = ?`,
				)
				.bind(
					homeScore,
					awayScore,
					hq.q1 ?? null,
					hq.q2 ?? null,
					hq.q3 ?? null,
					hq.q4 ?? null,
					aq.q1 ?? null,
					aq.q2 ?? null,
					aq.q3 ?? null,
					aq.q4 ?? null,
					hq.ot1 ?? null,
					hq.ot2 ?? null,
					hq.ot3 ?? null,
					aq.ot1 ?? null,
					aq.ot2 ?? null,
					aq.ot3 ?? null,
					body.observations?.trim() || null,
					body.pbp ? JSON.stringify(body.pbp.slice(0, 200)) : null,
					matchId,
				),
			getDb().prepare('DELETE FROM match_stats WHERE match_id = ?').bind(matchId),
			getDb().prepare('DELETE FROM live_matches WHERE match_id = ?').bind(matchId),
		];

		const insertStat = async (
			teamId: number,
			list: ActaPlayerPayload[],
			existing: { id: number; name: string; number: string | null }[],
		) => {
			for (const p of list) {
				if (p.played === false) continue;
				const playerId = await resolvePlayerId(teamId, p, existing);
				const fg2 = Math.max(0, Math.round(Number(p.fg2) || 0));
				const fg3 = Math.max(0, Math.round(Number(p.fg3) || 0));
				const ftm = Math.max(0, Math.round(Number(p.ftm) || 0));
				const fta = Math.max(ftm, Math.round(Number(p.fta) || 0));
				const fouls = Math.max(0, Math.min(5, Math.round(Number(p.fouls) || 0)));
				const pts = fg2 * 2 + fg3 * 3 + ftm;

				statements.push(
					getDb()
						.prepare(
							`INSERT OR REPLACE INTO match_stats
								(match_id, player_id, points, field_goals_made, three_pt_made,
								 free_throws_made, free_throws_attempted, fouls)
							 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						)
						.bind(matchId, playerId, pts, fg2, fg3, ftm, fta, fouls),
				);
			}
		};

		await insertStat(match.home_id, body.players?.home ?? [], homeExisting);
		await insertStat(match.away_id, body.players?.away ?? [], awayExisting);

		await getDb().batch(statements);
		await recomputeStandings();

		return json({ ok: true, mode: 'final', matchId, homeScore, awayScore });
	}

	return json({ error: 'mode inválido (usa live o final)' }, 400);
};
