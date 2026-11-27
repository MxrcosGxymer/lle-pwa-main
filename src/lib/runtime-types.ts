export interface SqlStatement {
	bind(...values: unknown[]): SqlStatement;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	run(): Promise<unknown>;
}

export interface SqlDatabase {
	prepare(query: string): SqlStatement;
	batch(statements: SqlStatement[]): Promise<unknown[]>;
}

export interface MediaObject {
	body: ReadableStream<Uint8Array> | ArrayBuffer | null;
	size?: number;
	contentType?: string;
}

export interface MediaStorage {
	get(key: string): Promise<MediaObject | null>;
	put(
		key: string,
		value: File | Blob | ArrayBuffer | ReadableStream<Uint8Array>,
		options?: {
			httpMetadata?: {
				contentType?: string;
				cacheControl?: string;
			};
		},
	): Promise<void>;
}
