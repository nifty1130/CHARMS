/**
 * PeerLink の結合テスト（実際のブラウザで動かす）
 *
 * 1つのページの中に2つの PeerLink を作り、QR で読み取る文字列を直接渡して
 * 本物の WebRTC 接続が開通することを確かめる。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { LinkError, PacketDecodeError, SelfConnectionError } from './errors';
import { PeerLink } from './link';
import type { LinkState, PeerLinkOptions } from './types';

const links: PeerLink[] = [];

function createLink(options: PeerLinkOptions = {}): PeerLink {
	const link = new PeerLink(options);
	links.push(link);
	return link;
}

afterEach(() => {
	for (const link of links.splice(0)) link.close();
});

describe('PeerLink', () => {
	it('QR の文字列を交換するだけで DataChannel が開通し、双方向に送受信できる', async () => {
		const statesA: LinkState[] = [];
		const receivedA: unknown[] = [];
		const receivedB: unknown[] = [];
		const a = createLink({
			onStateChange: (s) => statesA.push(s),
			onMessage: (d) => receivedA.push(d)
		});
		const b = createLink({ onMessage: (d) => receivedB.push(d) });

		await Promise.all([a.prepare(), b.prepare()]);
		expect(a.state).toBe('ready');
		expect(a.qrText).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
		// QR バージョン 10（誤り訂正 L、英数字モード）の容量 395 文字に余裕で収まる
		expect(a.qrText.length).toBeLessThan(300);

		await Promise.all([a.acceptRemote(b.qrText), b.acceptRemote(a.qrText)]);
		await Promise.all([a.opened(), b.opened()]);

		expect(a.state).toBe('connected');
		expect(b.state).toBe('connected');
		expect(statesA).toEqual(['gathering', 'ready', 'connecting', 'connected']);

		expect(a.send('A から B へ')).toBe(true);
		expect(b.send('B から A へ')).toBe(true);
		await expect.poll(() => receivedB).toEqual(['A から B へ']);
		await expect.poll(() => receivedA).toEqual(['B から A へ']);

		// 確認コードは両端で一致する
		const code = await a.verificationCode();
		expect(code).toMatch(/^\d{4}$/);
		expect(await b.verificationCode()).toBe(code);
	});

	it('片方が先に読み取り、もう片方が遅れて読み取ってもつながる', async () => {
		const a = createLink();
		const b = createLink();
		await Promise.all([a.prepare(), b.prepare()]);

		await a.acceptRemote(b.qrText);
		await new Promise((resolve) => setTimeout(resolve, 3000));
		expect(a.state).toBe('connecting');

		await b.acceptRemote(a.qrText);
		await Promise.all([a.opened(), b.opened()]);
		expect(a.state).toBe('connected');
	});

	it('同じ QR を何度読み取っても問題ない', async () => {
		const a = createLink();
		const b = createLink();
		await Promise.all([a.prepare(), b.prepare()]);

		await a.acceptRemote(b.qrText);
		await a.acceptRemote(b.qrText);
		await b.acceptRemote(a.qrText);
		await a.opened();
		await a.acceptRemote(b.qrText);
		expect(a.state).toBe('connected');
	});

	it('相手が接続を終了すると closed になる', async () => {
		const a = createLink();
		const b = createLink();
		await Promise.all([a.prepare(), b.prepare()]);
		await Promise.all([a.acceptRemote(b.qrText), b.acceptRemote(a.qrText)]);
		await Promise.all([a.opened(), b.opened()]);

		b.close();
		await expect.poll(() => a.state).toBe('closed');
		expect(a.send('届かない')).toBe(false);
	});

	it('自分の QR を読み取るとエラーになり、そのまま相手の QR を待ち続けられる', async () => {
		const a = createLink();
		const b = createLink();
		await Promise.all([a.prepare(), b.prepare()]);

		await expect(a.acceptRemote(a.qrText)).rejects.toBeInstanceOf(SelfConnectionError);
		expect(a.state).toBe('ready');

		await Promise.all([a.acceptRemote(b.qrText), b.acceptRemote(a.qrText)]);
		await a.opened();
	});

	it('CHARMS ではない QR を読み取るとエラーになり、そのまま待ち続けられる', async () => {
		const a = createLink();
		await a.prepare();

		await expect(a.acceptRemote('https://example.com')).rejects.toBeInstanceOf(PacketDecodeError);
		await expect(a.acceptRemote('HELLO WORLD')).rejects.toBeInstanceOf(PacketDecodeError);
		expect(a.state).toBe('ready');
	});

	it('すでに別の相手を読み取っているときは、3台目の QR を拒否する', async () => {
		const a = createLink();
		const b = createLink();
		const c = createLink();
		await Promise.all([a.prepare(), b.prepare(), c.prepare()]);

		await a.acceptRemote(b.qrText);
		await expect(a.acceptRemote(c.qrText)).rejects.toBeInstanceOf(LinkError);
	});

	it('prepare() の前は QR を取得も読み取りもできない', async () => {
		const a = createLink();
		const b = createLink();
		await b.prepare();

		expect(() => a.qrText).toThrow(LinkError);
		await expect(a.acceptRemote(b.qrText)).rejects.toBeInstanceOf(LinkError);
	});

	it('時間内に開通しなければ failed になる', async () => {
		const errors: Error[] = [];
		const a = createLink({ connectTimeoutMs: 500, onError: (e) => errors.push(e) });
		const b = createLink();
		await Promise.all([a.prepare(), b.prepare()]);

		// b は a を読み取らないので、開通しない
		await a.acceptRemote(b.qrText);
		await expect(a.opened()).rejects.toThrow('時間内に接続できませんでした');
		expect(a.state).toBe('failed');
		expect(errors).toHaveLength(1);
	});

	it('開通前に close() すると opened() は失敗する', async () => {
		const a = createLink();
		await a.prepare();
		a.close();
		await expect(a.opened()).rejects.toBeInstanceOf(LinkError);
		expect(a.state).toBe('closed');
	});
});
