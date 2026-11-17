/**
 * CHARM Point の配信元（Cloudflare Workers）
 *
 * アプリ本体は静的ファイル（build/）で、そのまま配信する。
 * Worker が受け持つのは、ブラウザだけではできない部分（/api/ 以下）だけ。
 * アプリは /api/ に届かなくても動く（その場合は QR コードで、同じ LAN 内だけでつながる）。
 *
 * - /api/ice         STUN / TURN サーバーの一覧
 * - /api/room/<合言葉> 招待リンク・合言葉でつなぐための受け渡し場所（WebSocket）
 */

import { handleIce, type IceEnv } from './ice';
import { ROOM_CODE_PATTERN } from './room-logic';

export { Room } from './room';

export interface Env extends IceEnv {
	ASSETS: Fetcher;
	ROOMS: DurableObjectNamespace;
}

/**
 * アプリ自身のページから開かれた WebSocket かどうか
 *
 * ブラウザは WebSocket を開くときに Origin を必ず付けるので、
 * よそのサイトに埋め込まれて使われるのを防げる。
 */
function isOwnOrigin(request: Request): boolean {
	const origin = request.headers.get('Origin');
	if (!origin) return false;
	try {
		return new URL(origin).host === new URL(request.url).host;
	} catch {
		return false;
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (pathname === '/api/ice') return handleIce(request, env);

		const room = /^\/api\/room\/([^/]+)$/.exec(pathname);
		if (room) {
			if (!ROOM_CODE_PATTERN.test(room[1])) {
				return Response.json({ error: 'bad_code' }, { status: 400 });
			}
			if (!isOwnOrigin(request)) {
				return Response.json({ error: 'forbidden' }, { status: 403 });
			}
			return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
		}

		if (pathname.startsWith('/api/')) {
			return Response.json({ error: 'not_found' }, { status: 404 });
		}
		return env.ASSETS.fetch(request);
	}
} satisfies ExportedHandler<Env>;
