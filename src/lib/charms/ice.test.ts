import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

import {
	cachedIceServers,
	hasRelay,
	loadIceServers,
	mediaIceServers,
	parseIceServers,
	resetIceServers,
	withoutRelay
} from './ice';

const STUN = { urls: ['stun:stun.cloudflare.com:3478'] };
const TURN = { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' };

function respond(body: unknown, status = 200) {
	return vi.fn(async () => Response.json(body, { status }));
}

describe('parseIceServers', () => {
	it('STUN / TURN の一覧を読み取る', () => {
		expect(parseIceServers({ iceServers: [STUN, TURN], ttl: 86400 })).toEqual({
			servers: [STUN, TURN],
			ttl: 86400
		});
		// urls は文字列1つでもよい
		expect(parseIceServers({ iceServers: [{ urls: 'stun:example.test' }] })?.servers).toEqual([
			{ urls: ['stun:example.test'] }
		]);
	});

	it('使えない項目は捨てる', () => {
		const parsed = parseIceServers({
			iceServers: [
				null,
				{ urls: ['https://example.test'] },
				{ urls: ['turn:turn.example.test'] }, // 認証情報のない TURN
				STUN
			]
		});
		expect(parsed?.servers).toEqual([STUN]);
	});

	it('形式が違うものは null になる', () => {
		expect(parseIceServers(null)).toBeNull();
		expect(parseIceServers('<html>')).toBeNull();
		expect(parseIceServers({ iceServers: 'x' })).toBeNull();
	});
});

describe('loadIceServers', () => {
	beforeEach(() => {
		resetIceServers();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('取得した一覧を使い回し、しばらくは取り直さない', async () => {
		const fetcher = respond({ iceServers: [STUN, TURN], ttl: 86400 });
		vi.stubGlobal('fetch', fetcher);

		expect(await loadIceServers()).toEqual([STUN, TURN]);
		expect(await loadIceServers()).toEqual([STUN, TURN]);
		expect(cachedIceServers()).toEqual([STUN, TURN]);
		expect(fetcher).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(11 * 60_000);
		await loadIceServers();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('取得できないとき（オフラインの LAN など）は空の一覧になり、例外を投げない', async () => {
		const fetcher = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetcher);

		expect(await loadIceServers()).toEqual([]);
		expect(cachedIceServers()).toEqual([]);
		// 失敗の直後は試し直さない（つなぐ操作を毎回待たせない）
		await loadIceServers();
		expect(fetcher).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(31_000);
		await loadIceServers();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('API のない場所で配信されているとき（404）も、空の一覧になる', async () => {
		vi.stubGlobal('fetch', respond('Not Found', 404));
		expect(await loadIceServers()).toEqual([]);
	});

	it('取り直しに失敗しても、前回の認証情報が有効な間は使い続ける', async () => {
		vi.stubGlobal('fetch', respond({ iceServers: [STUN, TURN], ttl: 86400 }));
		await loadIceServers();

		vi.advanceTimersByTime(11 * 60_000);
		vi.stubGlobal('fetch', respond({}, 500));
		expect(await loadIceServers()).toEqual([STUN, TURN]);
		expect(cachedIceServers()).toEqual([STUN, TURN]);
	});

	it('認証情報の期限が近づいたら使わない', async () => {
		vi.stubGlobal('fetch', respond({ iceServers: [TURN], ttl: 2 * 3600 }));
		await loadIceServers();

		vi.stubGlobal('fetch', respond({}, 500));
		vi.advanceTimersByTime(61 * 60_000);
		expect(await loadIceServers()).toEqual([]);
		expect(cachedIceServers()).toEqual([]);
	});

	it('端末がオフラインだと分かっているときは、問い合わせない', async () => {
		const fetcher = respond({ iceServers: [STUN], ttl: 60 });
		vi.stubGlobal('fetch', fetcher);
		vi.stubGlobal('navigator', { onLine: false });

		expect(await loadIceServers()).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe('映像の中継（TURN）の制限', () => {
	beforeEach(() => resetIceServers());
	afterEach(() => vi.unstubAllGlobals());

	it('TURN を除いて STUN だけを残し、TURN があるかを調べられる', () => {
		const mixed = { urls: ['stun:a.example:3478', 'turns:b.example:5349'], username: 'u', credential: 'c' };
		expect(withoutRelay([STUN, TURN, mixed])).toEqual([STUN, { urls: ['stun:a.example:3478'] }]);
		expect(hasRelay([STUN, TURN])).toBe(true);
		expect(hasRelay([STUN])).toBe(false);
		expect(hasRelay(withoutRelay([STUN, TURN]))).toBe(false);
	});

	it('映像接続には、中継を許したときだけ TURN を使う', async () => {
		vi.stubGlobal('fetch', respond({ iceServers: [STUN, TURN], ttl: 86400 }));
		await loadIceServers();
		expect(mediaIceServers(false)).toEqual([STUN]);
		expect(mediaIceServers(true)).toEqual([STUN, TURN]);
	});
});
