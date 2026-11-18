/**
 * STUN / TURN サーバーの情報を取得する
 *
 * インターネットにつながっているときは、アプリの配信元（Cloudflare Workers）から
 * STUN / TURN サーバーの一覧と、短時間だけ有効な認証情報を受け取る。
 * これを使うと、別のネットワークにいる端末同士や、端末間の通信を止めている Wi-Fi でもつながる。
 *
 * インターネットにつながっていないとき（当日の LAN だけの運用）は空の一覧になり、
 * これまでどおり同じ LAN 内だけでつながる。
 */

import { base } from '$app/paths';

/** 取得を待つ最大時間。オフラインの LAN で、つなぐ操作を長く待たせないようにする */
const FETCH_TIMEOUT_MS = 2500;
/** 取得できた一覧を、取り直さずに使い回す時間 */
const REFRESH_AFTER_MS = 10 * 60_000;
/** 取得に失敗したあと、次に試すまでの時間 */
const RETRY_AFTER_MS = 30_000;
/** 認証情報の期限切れより、どれだけ手前で使うのをやめるか */
const EXPIRY_MARGIN_MS = 60 * 60_000;

interface Cache {
	servers: RTCIceServer[];
	/** 取得（または失敗）した時刻 */
	at: number;
	/** この時刻を過ぎたら使わない */
	expires: number;
	ok: boolean;
}

let cache: Cache | null = null;
let loading: Promise<RTCIceServer[]> | null = null;

/** サーバーから届いた内容を検査して、使える項目だけを残す */
export function parseIceServers(data: unknown): { servers: RTCIceServer[]; ttl: number } | null {
	if (typeof data !== 'object' || data === null) return null;
	const { iceServers, ttl } = data as { iceServers?: unknown; ttl?: unknown };
	if (!Array.isArray(iceServers)) return null;

	const servers: RTCIceServer[] = [];
	for (const entry of iceServers) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { urls, username, credential } = entry as Record<string, unknown>;
		const list = (Array.isArray(urls) ? urls : [urls]).filter(
			(url): url is string => typeof url === 'string' && /^(stun|turn|turns):/.test(url)
		);
		if (list.length === 0) continue;

		const server: RTCIceServer = { urls: list };
		if (typeof username === 'string' && typeof credential === 'string') {
			server.username = username;
			server.credential = credential;
		} else if (list.some((url) => !url.startsWith('stun:'))) {
			// 認証情報のない TURN は使えないので捨てる
			continue;
		}
		servers.push(server);
	}
	return { servers, ttl: typeof ttl === 'number' && ttl > 0 ? ttl : 3600 };
}

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * いま手元にある STUN / TURN サーバーの一覧を返す（待たない）
 *
 * 古くなっていたら、裏で取り直しておく。期限切れやオフラインのときは空の一覧を返す。
 */
export function cachedIceServers(): RTCIceServer[] {
	if (isOffline()) return [];
	const now = Date.now();
	if (!cache || now - cache.at > (cache.ok ? REFRESH_AFTER_MS : RETRY_AFTER_MS)) {
		void loadIceServers();
	}
	return cache && cache.ok && now < cache.expires ? cache.servers : [];
}

/**
 * STUN / TURN サーバーの一覧を取得する
 *
 * 失敗しても例外は投げず、空の一覧（＝同じ LAN 内だけでつなぐ）を返す。
 */
export function loadIceServers(): Promise<RTCIceServer[]> {
	if (typeof fetch === 'undefined' || isOffline()) return Promise.resolve([]);

	const now = Date.now();
	if (cache && now - cache.at <= (cache.ok ? REFRESH_AFTER_MS : RETRY_AFTER_MS)) {
		return Promise.resolve(cache.ok && now < cache.expires ? cache.servers : []);
	}

	loading ??= (async () => {
		try {
			const response = await fetch(`${base}/api/ice`, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				cache: 'no-store'
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const parsed = parseIceServers(await response.json());
			if (!parsed) throw new Error('形式が違います');

			const at = Date.now();
			cache = {
				servers: parsed.servers,
				at,
				expires: at + Math.max(0, parsed.ttl * 1000 - EXPIRY_MARGIN_MS),
				ok: true
			};
			return parsed.servers;
		} catch {
			// 配信元に届かない（オフライン、または API のない場所で配信している）
			const previous = cache;
			const at = Date.now();
			if (previous?.ok && at < previous.expires) {
				// 前回の認証情報がまだ有効なら、それを使い続ける
				cache = { ...previous, at: at - REFRESH_AFTER_MS + RETRY_AFTER_MS };
				return previous.servers;
			}
			cache = { servers: [], at, expires: 0, ok: false };
			return [];
		} finally {
			loading = null;
		}
	})();
	return loading;
}

/** 手元の一覧を捨てる（テスト用） */
export function resetIceServers(): void {
	cache = null;
	loading = null;
}

/** 中継サーバー（TURN）の URL か */
function isRelayUrl(url: string): boolean {
	return /^turns?:/i.test(url);
}

/**
 * 一覧から中継サーバー（TURN）を除く（STUN だけを残す）
 *
 * 映像の中継は通信量に応じて費用がかかるので、ホストが許したときだけ使う。
 */
export function withoutRelay(servers: RTCIceServer[]): RTCIceServer[] {
	const result: RTCIceServer[] = [];
	for (const server of servers) {
		const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !isRelayUrl(url));
		if (urls.length > 0) result.push({ urls });
	}
	return result;
}

/** 一覧に中継サーバー（TURN）が入っているか（配信元に TURN の鍵が登録されているか） */
export function hasRelay(servers: RTCIceServer[]): boolean {
	return servers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(isRelayUrl));
}

/** 映像接続に使う STUN / TURN の一覧（中継を許していなければ、TURN を除く） */
export function mediaIceServers(allowRelay: boolean): RTCIceServer[] {
	const servers = cachedIceServers();
	return allowRelay ? servers : withoutRelay(servers);
}
