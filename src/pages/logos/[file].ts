import { getMedia } from '../../lib/runtime';

export const prerender = false;

const CONTENT_TYPES: Record<string, string> = {
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

export const GET = async ({ params }: { params: Record<string, string | undefined> }) => {
	const file = params.file;

	if (!file || !/^[a-z0-9-]+\.(svg|png|jpe?g|webp)$/.test(file)) {
		return new Response('Not Found', { status: 404 });
	}

	const ext = file.slice(file.lastIndexOf('.') + 1);
	const contentType = CONTENT_TYPES[ext];
	if (!contentType) {
		return new Response('Not Found', { status: 404 });
	}

	const object = await getMedia().get(`logos/${file}`);
	if (object === null) {
		return new Response('Not Found', { status: 404 });
	}

	const headers: Record<string, string> = {
		'Content-Type': contentType,
		'Cache-Control': 'public, max-age=86400',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
	};
	if (object.size !== undefined) {
		headers['Content-Length'] = String(object.size);
	}

	return new Response(object.body, { headers });
};