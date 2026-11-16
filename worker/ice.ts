/**
 * /api/ice — STUN / TURN サーバーの一覧を返す
 *
 * - STUN: Cloudflare の公開 STUN サーバー（無料・認証なし）
 * - TURN: Cloudflare Realtime TURN。長期の鍵（TURN_KEY_ID / TURN_KEY_API_TOKEN）は Worker の中だけに置き、
 *   ブラウザには短時間だけ有効な認証情報を発行して渡す
 *
 * TURN の鍵を設定していないときは、STUN だけを返す。
 */

/** 発行する TURN 認証情報の有効時間（秒）。催し1日分。Cloudflare の上限は 48 時間 */
export const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;

const STUN_SERVER = { urls: ['stun:stun.cloudflare.com:3478'] };

/**
 * ブラウザに渡す TURN の接続先
 *
 * Cloudflare は6種類の接続先を返すが、全部を試すと候補の収集に時間がかかるので、
 * 「ふつうの UDP」「UDP が止められているときの TCP」「厳しいファイアウォール向けの TLS(443)」に絞る。
 */
const TURN_URLS = [
	'turn:turn.cloudflare.com:3478?transport=udp',
	'turn:turn.cloudflare.com:3478?transport=tcp',
	'turns:turn.cloudflare.com:443?transport=tcp'
];

export interface IceEnv {
	TURN_KEY_ID?: string;
	TURN_KEY_API_TOKEN?: string;
}

interface IceServer {
	urls: string[];
	username?: string;
	credential?: string;
}

export interface IceResponse {
	iceServers: IceServer[];
	/** 認証情報の有効時間（秒） */
	ttl: number;
	/** TURN（中継）が使えるか */
	relay: boolean;
}

/** Cloudflare から TURN の認証情報を発行してもらう。失敗したら null */
async function issueTurnServer(env: IceEnv, fetcher: typeof fetch): Promise<IceServer | null> {
	if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;

	try {
		const response = await fetcher(
			`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS })
			}
		);
		if (!response.ok) return null;

		const data = (await response.json()) as { iceServers?: IceServer[] };
		const turn = data.iceServers?.find(
			(server) => typeof server.username === 'string' && typeof server.credential === 'string'
		);
		if (!turn?.username || !turn.credential) return null;

		return { urls: TURN_URLS, username: turn.username, credential: turn.credential };
	} catch {
		return null;
	}
}

/** STUN / TURN サーバーの一覧を組み立てる */
export async function buildIceResponse(env: IceEnv, fetcher: typeof fetch = fetch): Promise<IceResponse> {
	const turn = await issueTurnServer(env, fetcher);
	return {
		iceServers: turn ? [STUN_SERVER, turn] : [STUN_SERVER],
		ttl: CREDENTIAL_TTL_SECONDS,
		relay: turn !== null
	};
}

/**
 * アプリ自身のページからの要求かどうか
 *
 * ブラウザは `Sec-Fetch-Site` を付けるので、よそのサイトに埋め込まれて
 * TURN の認証情報を持ち出されるのを防げる（ブラウザ以外からの要求までは防げない）。
 */
export function isSameSiteRequest(request: Request): boolean {
	const site = request.headers.get('Sec-Fetch-Site');
	return site === null || site === 'same-origin';
}

export async function handleIce(request: Request, env: IceEnv): Promise<Response> {
	if (request.method !== 'GET') {
		return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET' } });
	}
	if (!isSameSiteRequest(request)) {
		return Response.json({ error: 'forbidden' }, { status: 403 });
	}
	return Response.json(await buildIceResponse(env), {
		headers: { 'Cache-Control': 'no-store' }
	});
}
