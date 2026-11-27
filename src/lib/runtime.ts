import { env } from 'cloudflare:workers';
import type { MediaObject, MediaStorage, SqlDatabase, SqlStatement } from './runtime-types';

export type { MediaObject, MediaStorage, SqlDatabase, SqlStatement };

export function getDb(): SqlDatabase {
	return env.lle_pwa as unknown as SqlDatabase;
}

export function getMedia(): MediaStorage {
	return {
		async get(key: string): Promise<MediaObject | null> {
			const obj = await env.MEDIA.get(key);
			if (obj === null) return null;
			return {
				body: obj.body as ReadableStream<Uint8Array>,
				size: obj.size,
				contentType: obj.httpMetadata?.contentType,
			};
		},
		async put(key, value, options) {
			await env.MEDIA.put(key, value, options);
		},
	};
}

export function getAdminUsersRaw(): string | undefined {
	return (env as unknown as { ADMIN_USERS?: string }).ADMIN_USERS;
}
