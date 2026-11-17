import { describe, expect, it } from 'vitest';
import {
	admit,
	CLAIM_TTL_MS,
	HOST_KEY_PATTERN,
	MAX_MESSAGE_LENGTH,
	MAX_NODES,
	relay,
	ROOM_CODE_PATTERN,
	sha256Hex,
	type Claim
} from './room-logic';

const NOW = 1_800_000_000_000;
const PACKET = 'QED8WEX0QED8WEX0QED8WEX0 $%*+-./:';
const claim = (keyHash: string, ago = 0): Claim => ({ keyHash, seenAt: NOW - ago });

describe('合言葉と鍵の形式', () => {
	it('合言葉は6桁の数字だけ', () => {
		expect(ROOM_CODE_PATTERN.test('012345')).toBe(true);
		for (const bad of ['12345', '1234567', 'abcdef', '12 345', '']) {
			expect(ROOM_CODE_PATTERN.test(bad)).toBe(false);
		}
	});

	it('ホストの鍵は、十分に長い英数字だけ', () => {
		expect(HOST_KEY_PATTERN.test('a'.repeat(32))).toBe(true);
		expect(HOST_KEY_PATTERN.test('short')).toBe(false);
		expect(HOST_KEY_PATTERN.test('a'.repeat(31) + '&')).toBe(false);
	});
});

describe('admit', () => {
	const base = { claim: null, hostConnected: false, nodeCount: 0, now: NOW };

	it('空いている合言葉は、最初に来たホストのものになる', () => {
		expect(admit({ ...base, role: 'host', keyHash: 'A' })).toEqual({ ok: true, replaceHost: false });
	});

	it('鍵のないホストは断る', () => {
		expect(admit({ ...base, role: 'host', keyHash: null })).toEqual({ ok: false, reason: 'bad_request' });
	});

	it('使われている合言葉を、別のホストは使えない', () => {
		const taken = { ok: false, reason: 'taken' };
		expect(admit({ ...base, role: 'host', keyHash: 'B', claim: claim('A'), hostConnected: true })).toEqual(taken);
		// ホストが一時的にいないとき（再読み込み中など）も、しばらくは取られない
		expect(admit({ ...base, role: 'host', keyHash: 'B', claim: claim('A', CLAIM_TTL_MS - 1) })).toEqual(taken);
	});

	it('同じ鍵のホストは戻ってこられる（前の接続があれば入れ替える）', () => {
		expect(admit({ ...base, role: 'host', keyHash: 'A', claim: claim('A', 60_000) })).toEqual({
			ok: true,
			replaceHost: false
		});
		expect(admit({ ...base, role: 'host', keyHash: 'A', claim: claim('A'), hostConnected: true })).toEqual({
			ok: true,
			replaceHost: true
		});
	});

	it('ホストがいなくなって時間が経った合言葉は、別のホストが使える', () => {
		expect(admit({ ...base, role: 'host', keyHash: 'B', claim: claim('A', CLAIM_TTL_MS + 1) })).toEqual({
			ok: true,
			replaceHost: false
		});
	});

	it('端末は、ホストがいなくても待てる。上限を超えたら断る', () => {
		expect(admit({ ...base, role: 'node', keyHash: null })).toEqual({ ok: true, replaceHost: false });
		expect(admit({ ...base, role: 'node', keyHash: null, nodeCount: MAX_NODES })).toEqual({
			ok: false,
			reason: 'full'
		});
	});
});

describe('relay', () => {
	const node = { role: 'node', id: 'n1' } as const;
	const host = { role: 'host', id: 'h1' } as const;

	it('端末の申し込みを、送り主の番号を付けてホストへ届ける', () => {
		expect(relay(node, JSON.stringify({ type: 'offer', packet: PACKET }))).toEqual({
			delivery: { to: 'host' },
			message: { type: 'join', peer: 'n1', packet: PACKET }
		});
	});

	it('ホストの返事を、指定された端末へ届ける', () => {
		expect(relay(host, JSON.stringify({ type: 'answer', peer: 'n1', packet: PACKET }))).toEqual({
			delivery: { to: 'node', peer: 'n1' },
			message: { type: 'answer', packet: PACKET }
		});
		expect(relay(host, JSON.stringify({ type: 'reject', peer: 'n1', reason: 'busy' }))).toEqual({
			delivery: { to: 'node', peer: 'n1' },
			message: { type: 'reject', reason: 'busy' }
		});
	});

	it('端末は、ホストのふりをして他の端末へ送れない', () => {
		expect(relay(node, JSON.stringify({ type: 'answer', peer: 'n2', packet: PACKET }))).toBeNull();
		expect(relay(node, JSON.stringify({ type: 'reject', peer: 'n2' }))).toBeNull();
	});

	it('形式の違うメッセージは無視する', () => {
		expect(relay(node, 'not json')).toBeNull();
		expect(relay(node, 'null')).toBeNull();
		expect(relay(node, JSON.stringify({ type: 'offer' }))).toBeNull();
		// 接続情報に使えない文字（小文字や改行）が混ざっている
		expect(relay(node, JSON.stringify({ type: 'offer', packet: PACKET + 'abc' }))).toBeNull();
		expect(relay(node, JSON.stringify({ type: 'offer', packet: `${PACKET}\n${PACKET}` }))).toBeNull();
		expect(relay(host, JSON.stringify({ type: 'answer', packet: PACKET }))).toBeNull();
		expect(relay(node, JSON.stringify({ type: 'offer', packet: 'A'.repeat(MAX_MESSAGE_LENGTH) }))).toBeNull();
	});
});

describe('sha256Hex', () => {
	it('SHA-256 を16進数で返す', async () => {
		expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});
