import { createClient, type Client, type InValue } from '@libsql/client/web';
import { list, put } from '@vercel/blob';
import type { MediaObject, MediaStorage, SqlDatabase, SqlStatement } from './runtime-types';

export type { MediaObject, MediaStorage, SqlDatabase, SqlStatement };

interface InternalStatement extends SqlStatement {
	readonly _sql: string;
	readonly _args: InValue[];
}

function normalizeArgs(values: unknown[]): InValue[] {
	return values.map((v) => {
		if (v === undefined || v === null) return null;
		if (
			typeof v === 'string' ||
			typeof v === 'number' ||
			typeof v === 'boolean' ||
			typeof v === 'bigint' ||
			v instanceof Uint8Array ||
			v instanceof ArrayBuffer
		) {
			return v;
		}
		return String(v);
	});
}

function rowsToObjects<T>(columns: string[], rows: ArrayLike<unknown>[]): T[] {
	return rows.map((row) => {
		const obj: Record<string, unknown> = {};
		for (let i = 0; i < columns.length; i++) {
			const val = row[i];
			obj[columns[i]] = typeof val === 'bigint' ? Number(val) : val;
		}
		return obj as T;
	});
}

let cachedLibsqlClient: Client | null = null;

function getLibsqlClient(): Client {
	if (!cachedLibsqlClient) {
		const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
		if (!url) {
			throw new Error('Missing TURSO_DATABASE_URL (or LIBSQL_URL)');
		}
		const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;
		cachedLibsqlClient = createClient({ url, authToken });
	}
	return cachedLibsqlClient;
}

function createLibsqlDb(): SqlDatabase {
	const client = getLibsqlClient();

	const makeStatement = (sql: string, args: InValue[] = []): InternalStatement => ({
		_sql: sql,
		_args: args,
		bind(...values: unknown[]) {
			return makeStatement(sql, normalizeArgs(values));
		},
		async all<T = Record<string, unknown>>() {
			const rs = await client.execute({ sql, args });
			return { results: rowsToObjects<T>(rs.columns, rs.rows) };
		},
		async first<T = Record<string, unknown>>() {
			const rs = await client.execute({ sql, args });
			const rows = rowsToObjects<T>(rs.columns, rs.rows);
			return rows[0] ?? null;
		},
		async run() {
			return client.execute({ sql, args });
		},
	});

	return {
		prepare(query: string) {
			return makeStatement(query);
		},
		async batch(statements: SqlStatement[]) {
			const stmts = (statements as InternalStatement[]).map((s) => ({
				sql: s._sql,
				args: s._args,
			}));
			return client.batch(stmts, 'write');
		},
	};
}

interface D1ApiResponse<T = Record<string, unknown>> {
	success: boolean;
	errors?: { message: string }[];
	result?: { results?: T[] }[];
}

function createCloudflareD1HttpDb(
	accountId: string,
	databaseId: string,
	apiToken: string,
): SqlDatabase {
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

	async function execute<T = Record<string, unknown>>(
		sql: string,
		params: InValue[],
	): Promise<T[]> {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ sql, params }),
		});

		const data = (await res.json()) as D1ApiResponse<T>;
		if (!res.ok || !data.success) {
			const msg = data.errors?.map((e) => e.message).join('; ') || res.statusText;
			throw new Error(`Cloudflare D1 HTTP error (${res.status}): ${msg}`);
		}
		return data.result?.[0]?.results ?? [];
	}

	const makeStatement = (sql: string, args: InValue[] = []): InternalStatement => ({
		_sql: sql,
		_args: args,
		bind(...values: unknown[]) {
			return makeStatement(sql, normalizeArgs(values));
		},
		async all<T = Record<string, unknown>>() {
			const results = await execute<T>(sql, args);
			return { results };
		},
		async first<T = Record<string, unknown>>() {
			const results = await execute<T>(sql, args);
			return results[0] ?? null;
		},
		async run() {
			return execute(sql, args);
		},
	});

	return {
		prepare(query: string) {
			return makeStatement(query);
		},
		async batch(statements: SqlStatement[]) {
			const out: unknown[] = [];
			for (const s of statements as InternalStatement[]) {
				out.push(await execute(s._sql, s._args));
			}
			return out;
		},
	};
}

let cachedDb: SqlDatabase | null = null;

export function getDb(): SqlDatabase {
	if (cachedDb) return cachedDb;

	if (process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL) {
		cachedDb = createLibsqlDb();
		return cachedDb;
	}

	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
	if (accountId && apiToken && databaseId) {
		cachedDb = createCloudflareD1HttpDb(accountId, databaseId, apiToken);
		return cachedDb;
	}

	throw new Error(
		'Database not configured for Vercel. Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_D1_DATABASE_ID + CLOUDFLARE_API_TOKEN.',
	);
}

export function getMedia(): MediaStorage {
	return {
		async get(key: string): Promise<MediaObject | null> {
			if (process.env.BLOB_READ_WRITE_TOKEN) {
				const { blobs } = await list({ prefix: key, limit: 5 });
				const match = blobs.find((b) => b.pathname === key);
				if (match) {
					const res = await fetch(match.url);
					if (!res.ok) return null;
					return {
						body: res.body,
						size: match.size,
						contentType: res.headers.get('content-type') ?? undefined,
					};
				}
			}

			const baseUrl = process.env.MEDIA_BASE_URL?.replace(/\/+$/, '');
			if (baseUrl) {
				const res = await fetch(`${baseUrl}/${key}`);
				if (!res.ok) return null;
				const len = res.headers.get('content-length');
				return {
					body: res.body,
					size: len ? Number(len) : undefined,
					contentType: res.headers.get('content-type') ?? undefined,
				};
			}

			return null;
		},

		async put(key, value, options) {
			if (!process.env.BLOB_READ_WRITE_TOKEN) {
				throw new Error(
					'Media upload on Vercel requires BLOB_READ_WRITE_TOKEN (Vercel Blob).',
				);
			}
			await put(key, value as Blob | File | ArrayBuffer | ReadableStream, {
				access: 'public',
				addRandomSuffix: false,
				allowOverwrite: true,
				contentType: options?.httpMetadata?.contentType,
			});
		},
	};
}

export function getAdminUsersRaw(): string | undefined {
	return process.env.ADMIN_USERS;
}

export function getActaSyncSecret(): string {
	return process.env.ACTA_SYNC_SECRET || 'lle-acta-sync-2026';
}
