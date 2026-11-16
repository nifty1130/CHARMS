/**
 * CHARM Point の配信元（Cloudflare Workers）
 *
 * アプリ本体は静的ファイル（build/）で、そのまま配信する。
 * Worker が受け持つのは、ブラウザだけではできない部分（/api/ 以下）だけ。
 * アプリは /api/ に届かなくても動く（その場合は同じ LAN 内だけでつながる）。
 */

import { handleIce, type IceEnv } from './ice';

export interface Env extends IceEnv {
	ASSETS: Fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/api/ice') return handleIce(request, env);
		if (pathname.startsWith('/api/')) {
			return Response.json({ error: 'not_found' }, { status: 404 });
		}
		return env.ASSETS.fetch(request);
	}
} satisfies ExportedHandler<Env>;
