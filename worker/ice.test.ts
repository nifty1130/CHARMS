import { describe, expect, it, vi } from 'vitest';
import { buildIceResponse, CREDENTIAL_TTL_SECONDS, handleIce, isSameSiteRequest } from './ice';

const KEYS = { TURN_KEY_ID: 'key-id', TURN_KEY_API_TOKEN: 'secret-token' };

/** Cloudflare の応答を真似る */
function cloudflare(body: unknown, status = 201): typeof fetch {
	return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
}

describe('buildIceResponse', () => {
	it('TURN の鍵がなければ、STUN だけを返す', async () => {
		const fetcher = cloudflare({});
		const result = await buildIceResponse({}, fetcher);

		expect(result.relay).toBe(false);
		expect(result.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('TURN の鍵があれば、短時間だけ有効な認証情報を発行して返す', async () => {
		const fetcher = cloudflare({
			iceServers: [
				{ urls: ['stun:stun.cloudflare.com:3478'] },
				{
					urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'],
					username: 'user',
					credential: 'pass'
				}
			]
		});
		const result = await buildIceResponse(KEYS, fetcher);

		expect(result.relay).toBe(true);
		expect(result.ttl).toBe(CREDENTIAL_TTL_SECONDS);
		expect(result.iceServers).toHaveLength(2);
		expect(result.iceServers[1]).toMatchObject({ username: 'user', credential: 'pass' });
		// ブラウザが止めているポート 53 など、余計な接続先は渡さない
		expect(result.iceServers[1].urls).toEqual([
			'turn:turn.cloudflare.com:3478?transport=udp',
			'turn:turn.cloudflare.com:3478?transport=tcp',
			'turns:turn.cloudflare.com:443?transport=tcp'
		]);

		const [url, init] = vi.mocked(fetcher).mock.calls[0];
		expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
		expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-token');
		expect(JSON.parse(String(init?.body))).toEqual({ ttl: CREDENTIAL_TTL_SECONDS });
	});

	it('長期の鍵そのものは、応答に含めない', async () => {
		const fetcher = cloudflare({ iceServers: [{ urls: ['turn:x'], username: 'u', credential: 'c' }] });
		const text = JSON.stringify(await buildIceResponse(KEYS, fetcher));

		expect(text).not.toContain('secret-token');
		expect(text).not.toContain('key-id');
	});

	it('自動テスト用の設定では、空の一覧を返す', async () => {
		const fetcher = cloudflare({});
		const result = await buildIceResponse({ ...KEYS, ICE_DISABLED: 'true' }, fetcher);
		expect(result.iceServers).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('TURN の発行に失敗しても、STUN だけで応答する', async () => {
		expect((await buildIceResponse(KEYS, cloudflare({ error: 'x' }, 500))).relay).toBe(false);
		expect((await buildIceResponse(KEYS, cloudflare({ iceServers: [] }))).relay).toBe(false);

		const offline = vi.fn(async () => {
			throw new Error('network');
		}) as unknown as typeof fetch;
		expect((await buildIceResponse(KEYS, offline)).iceServers).toHaveLength(1);
	});
});

describe('handleIce', () => {
	it('アプリ自身のページからの GET に応答し、保存させない', async () => {
		const response = await handleIce(
			new Request('https://example.test/api/ice', { headers: { 'Sec-Fetch-Site': 'same-origin' } }),
			{}
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ relay: false });
	});

	it('よそのサイトからの要求と、GET 以外は断る', async () => {
		const cross = new Request('https://example.test/api/ice', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
		expect(isSameSiteRequest(cross)).toBe(false);
		expect((await handleIce(cross, {})).status).toBe(403);

		const post = new Request('https://example.test/api/ice', { method: 'POST' });
		expect((await handleIce(post, {})).status).toBe(405);
	});
});
