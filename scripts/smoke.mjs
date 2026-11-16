/**
 * 公開したサイトの動作確認（npm run smoke -- https://charmpoint.nifty1130.com）
 *
 * 自動テストでは確かめられない「本物の STUN / TURN サーバーを使った接続」を、
 * 実際のサイトに対して確かめる。
 *
 * 1. /api/ice が STUN / TURN の一覧を返すか
 * 2. その一覧で、外側のアドレス（srflx）と中継用のアドレス（relay）が取れるか
 * 3. 中継だけに限定しても、2つの接続がつながるか（TURN が実際に使えるか）
 * 4. アプリの画面で、ホストとカメラがつながり、映像が届くか
 */

import { chromium } from '@playwright/test';

const origin = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const results = [];
const report = (name, ok, detail = '') => {
	results.push(ok);
	console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const context = await browser.newContext({ permissions: ['camera', 'microphone'], locale: 'ja-JP' });

try {
	const page = await context.newPage();
	await page.goto(`${origin}/`);

	// 1. STUN / TURN の一覧
	const ice = await page.evaluate(async () => {
		const response = await fetch('/api/ice', { cache: 'no-store' });
		return { status: response.status, body: response.ok ? await response.json() : null };
	});
	report('/api/ice が応答する', ice.status === 200, `HTTP ${ice.status}`);
	const servers = ice.body?.iceServers ?? [];
	report('TURN（中継）が有効', ice.body?.relay === true, ice.body?.relay ? '' : 'TURN の鍵が未設定（STUN のみ）');

	// 2. 候補の種類
	const kinds = await page.evaluate(async (iceServers) => {
		const pc = new RTCPeerConnection({ iceServers });
		pc.createDataChannel('probe');
		const found = new Set();
		const done = new Promise((resolve) => {
			pc.onicecandidate = (event) => {
				if (event.candidate) found.add(event.candidate.type);
				else resolve();
			};
			setTimeout(resolve, 8000);
		});
		await pc.setLocalDescription(await pc.createOffer());
		await done;
		pc.close();
		return [...found];
	}, servers);
	report('外側のアドレス（srflx）が取れる', kinds.includes('srflx'), kinds.join(', '));
	if (ice.body?.relay) {
		report('中継用のアドレス（relay）が取れる', kinds.includes('relay'), kinds.join(', '));

		// 3. 中継だけでつながるか
		const relayed = await page.evaluate(async (iceServers) => {
			const config = { iceServers, iceTransportPolicy: 'relay' };
			const a = new RTCPeerConnection(config);
			const b = new RTCPeerConnection(config);
			a.onicecandidate = (event) => event.candidate && b.addIceCandidate(event.candidate);
			b.onicecandidate = (event) => event.candidate && a.addIceCandidate(event.candidate);
			const channel = a.createDataChannel('probe');
			const opened = new Promise((resolve) => {
				channel.onopen = () => resolve(true);
				setTimeout(() => resolve(false), 15000);
			});
			await a.setLocalDescription(await a.createOffer());
			await b.setRemoteDescription(a.localDescription);
			await b.setLocalDescription(await b.createAnswer());
			await a.setRemoteDescription(b.localDescription);
			const ok = await opened;
			a.close();
			b.close();
			return ok;
		}, servers);
		report('中継（TURN）だけでつながる', relayed);
	}

	// 4. アプリの画面でつなぐ
	const host = await context.newPage();
	await host.goto(`${origin}/host/`);
	await host.getByRole('heading', { name: '端末をつなぐ' }).waitFor({ timeout: 20000 });

	const camera = await context.newPage();
	await camera.goto(`${origin}/camera/`);
	await camera.getByRole('button', { name: 'この端末のホストにつなぐ' }).click();
	await camera.getByRole('status').filter({ hasText: 'カメラ 1' }).waitFor({ timeout: 30000 });
	report('アプリの画面で、ホストとカメラがつながる', true);
	await camera.getByRole('button', { name: /この端末のカメラ/ }).click();

	const playing = await host
		.waitForFunction(
			() => [...document.querySelectorAll('video')].some((video) => video.videoWidth > 0 && !video.paused),
			null,
			{ timeout: 30000 }
		)
		.then(() => true)
		.catch(() => false);
	report('ホストに、カメラの確認用映像が届く', playing);
} catch (error) {
	report('途中でエラー', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
	await browser.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
