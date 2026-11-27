import type { APIRoute } from 'astro';
import { getLiveMatch, getMatch } from '../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const matchId = Number.parseInt(params.id ?? '', 10);
	if (!Number.isInteger(matchId) || matchId <= 0) {
		return new Response(JSON.stringify({ error: 'ID inválido' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}

	const [match, live] = await Promise.all([getMatch(matchId), getLiveMatch(matchId)]);
	if (!match) {
		return new Response(JSON.stringify({ error: 'Partido no encontrado' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	}

	if (!live) {
		return new Response(
			JSON.stringify({
				live: false,
				status: match.status,
				home_score: match.home_score,
				away_score: match.away_score,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
			},
		);
	}

	return new Response(
		JSON.stringify({
			live: true,
			status: match.status,
			home_score: live.home_score,
			away_score: live.away_score,
			period: live.period,
			clock_ms: live.clock_ms,
			shot_sec: live.shot_sec,
			quarters: {
				home: [live.home_q1, live.home_q2, live.home_q3, live.home_q4, live.home_ot1, live.home_ot2, live.home_ot3],
				away: [live.away_q1, live.away_q2, live.away_q3, live.away_q4, live.away_ot1, live.away_ot2, live.away_ot3],
			},
			players: live.stats_json ? JSON.parse(live.stats_json) : null,
			pbp: live.pbp_json ? JSON.parse(live.pbp_json) : [],
			updated_at: live.updated_at,
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		},
	);
};
