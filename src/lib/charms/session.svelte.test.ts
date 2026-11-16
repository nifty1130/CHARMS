/**
 * ホストと各端末の結合テスト（実際のブラウザで動かす）
 *
 * 1つのページの中にホスト・カメラ・モニター・スイッチャーを作り、
 * 本物の WebRTC で映像が届くこと、切り替えが反映されることを確かめる。
 * カメラはブラウザ内蔵のテスト用映像を使う。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ClientSession } from './client.svelte';
import { HostSession } from './host.svelte';
import { LocalHostFinder } from './local-pairing.svelte';
import type { CameraCommand, NodeRole } from './protocol';

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	localStorage.clear();
});

function createHost(): HostSession {
	const host = new HostSession();
	cleanups.push(() => host.destroy());
	return host;
}

/** 端末を作り、同じページ内のホストに（QR なしで）つなぐ */
async function join(role: NodeRole): Promise<ClientSession> {
	const client = new ClientSession(role);
	const finder = new LocalHostFinder();
	cleanups.push(() => {
		client.destroy();
		finder.close();
	});
	await client.pairing.start();
	await expect.poll(() => finder.available).toBe(true);
	expect(await finder.connect(client.pairing)).toBe(true);
	await expect.poll(() => client.connected).toBe(true);
	return client;
}

/** カメラの映像を出し始める */
async function goLive(camera: ClientSession): Promise<MediaStream> {
	const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
	cleanups.push(() => stream.getTracks().forEach((track) => track.stop()));
	await camera.media.setLocalStream(stream);
	camera.setStatus({ live: true, sourceKind: 'webcam', quality: 'medium' });
	return stream;
}

/** 映像が実際に届いて、絵が出ていることを確かめる */
async function expectVideoPlays(stream: MediaStream | undefined): Promise<void> {
	expect(stream).toBeDefined();
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.srcObject = stream!;
	document.body.append(video);
	cleanups.push(() => video.remove());
	await video.play();
	await expect.poll(() => video.videoWidth, { timeout: 10_000 }).toBeGreaterThan(0);
}

describe('ホストと端末', () => {
	it('端末がつながると、役割ごとに番号つきの名前が付き、全員に一覧が配られる', async () => {
		const host = createHost();
		const camera1 = await join('camera');
		const camera2 = await join('camera');
		const monitor = await join('monitor');

		expect(camera1.id).toBe('cam1');
		expect(camera2.id).toBe('cam2');
		expect(camera2.name).toBe('カメラ 2');
		expect(monitor.id).toBe('mon1');

		const names = ['カメラ 1', 'カメラ 2', 'モニター 1'];
		expect(host.snapshot.nodes.map((n) => n.name)).toEqual(names);
		await expect.poll(() => monitor.snapshot.nodes.map((n) => n.name)).toEqual(names);
		// モニターには、最初は何も映さない
		expect(host.snapshot.routes).toEqual([{ monitorId: 'mon1', program: null, preview: null }]);
	});

	it('カメラが映像を出すと、ホストとスイッチャーに確認用の映像が届く', async () => {
		const host = createHost();
		const camera = await join('camera');
		const controller = await join('controller');
		await goLive(camera);

		await expect.poll(() => Object.keys(host.thumbnails)).toEqual(['cam1']);
		await expect.poll(() => Object.keys(controller.thumbnails)).toEqual(['cam1']);
		await expectVideoPlays(host.thumbnails.cam1);
		await expectVideoPlays(controller.thumbnails.cam1);
		// 確認用の映像に音声は付かない
		expect(controller.thumbnails.cam1.getAudioTracks()).toHaveLength(0);
		expect(camera.targets.sort()).toEqual(['ctrl1', 'host']);
	});

	it('スイッチャーが切り替えると、選んだカメラの映像と音声がモニターに届く', async () => {
		const host = createHost();
		const camera1 = await join('camera');
		const camera2 = await join('camera');
		const monitor = await join('monitor');
		const controller = await join('controller');
		await goLive(camera1);
		await goLive(camera2);
		await expect.poll(() => controller.snapshot.nodes.filter((n) => n.live)).toHaveLength(2);

		controller.route(['mon1'], 'program', 'cam1');
		await expect.poll(() => Object.keys(monitor.streams)).toEqual(['cam1']);
		await expectVideoPlays(monitor.streams.cam1);
		expect(monitor.streams.cam1.getAudioTracks()).toHaveLength(1);
		expect(host.snapshot.routes[0]).toEqual({ monitorId: 'mon1', program: 'cam1', preview: null });

		// 予告を選ぶと、本番はそのままで、次の映像があらかじめ届く
		controller.route(['mon1'], 'preview', 'cam2');
		await expect.poll(() => Object.keys(monitor.streams).sort()).toEqual(['cam1', 'cam2']);
		expect(monitor.snapshot.routes[0].program).toBe('cam1');

		// 切替（TAKE）で本番と予告が入れ替わる。接続は張り直さない
		const before = monitor.streams.cam2;
		controller.take('all');
		await expect
			.poll(() => monitor.snapshot.routes[0])
			.toEqual({ monitorId: 'mon1', program: 'cam2', preview: 'cam1' });
		expect(monitor.streams.cam2).toBe(before);
		await expectVideoPlays(monitor.streams.cam2);
	});

	it('直接切り替えたときは、新しい映像が届くまで前の映像との接続を残す', async () => {
		const host = createHost();
		const camera1 = await join('camera');
		const camera2 = await join('camera');
		const monitor = await join('monitor');
		await goLive(camera1);
		await goLive(camera2);

		host.route('all', 'program', 'cam1');
		await expect.poll(() => Object.keys(monitor.streams)).toEqual(['cam1']);

		// 切り替えた直後は、両方の映像が届いている（黒い画面が挟まらない）
		host.route('all', 'program', 'cam2');
		await expect.poll(() => Object.keys(monitor.streams).sort()).toEqual(['cam1', 'cam2']);
		// しばらくすると、前の映像との接続は片付く
		await expect.poll(() => Object.keys(monitor.streams), { timeout: 8000 }).toEqual(['cam2']);
		expect(camera1.targets).toEqual(['host']);
	});

	it('全モニターを一括で切り替えられ、黒画面に戻すと映像接続が片付く', async () => {
		const host = createHost();
		const camera = await join('camera');
		const monitor1 = await join('monitor');
		const monitor2 = await join('monitor');
		await goLive(camera);

		host.route('all', 'program', 'cam1');
		await expect.poll(() => Object.keys(monitor1.streams)).toEqual(['cam1']);
		await expect.poll(() => Object.keys(monitor2.streams)).toEqual(['cam1']);
		await expect.poll(() => camera.targets.sort()).toEqual(['host', 'mon1', 'mon2']);

		host.route('all', 'program', null);
		await expect.poll(() => Object.keys(monitor1.streams)).toEqual([]);
		await expect.poll(() => camera.targets).toEqual(['host']);
	});

	it('カメラが切断されると、一覧と経路から消え、モニターの映像も片付く', async () => {
		const host = createHost();
		const camera = await join('camera');
		const monitor = await join('monitor');
		await goLive(camera);
		host.route('all', 'program', 'cam1');
		await expect.poll(() => Object.keys(monitor.streams)).toEqual(['cam1']);

		camera.destroy();
		await expect.poll(() => host.snapshot.nodes.map((n) => n.id)).toEqual(['mon1']);
		expect(host.snapshot.routes).toEqual([{ monitorId: 'mon1', program: null, preview: null }]);
		await expect.poll(() => Object.keys(monitor.streams)).toEqual([]);
		expect(host.events[0].text).toBe('カメラ 1 との接続が切れました');
	});

	it('名前の変更が全員に伝わり、端末に保存される', async () => {
		const host = createHost();
		const camera = await join('camera');
		const controller = await join('controller');

		controller.rename('cam1', '体育館ステージ');
		await expect.poll(() => camera.name).toBe('体育館ステージ');
		expect(host.snapshot.nodes[0].name).toBe('体育館ステージ');
		expect(localStorage.getItem('charms:name:camera')).toBe('体育館ステージ');
	});

	it('スイッチャーからカメラを遠隔操作でき、録画の許可が全員に伝わる', async () => {
		const host = createHost();
		const camera = await join('camera');
		const controller = await join('controller');
		const commands: CameraCommand[] = [];
		camera.onCameraCommand = (command) => commands.push(command);

		controller.cameraControl('cam1', { action: 'quality', quality: 'low' });
		await expect.poll(() => commands).toEqual([{ action: 'quality', quality: 'low' }]);

		expect(camera.snapshot.settings.allowRecording).toBe(false);
		host.setAllowRecording(true);
		await expect.poll(() => camera.snapshot.settings.allowRecording).toBe(true);
	});

	it('カメラやモニターからの切り替え指示は無視する（操作できるのはスイッチャーとホストだけ）', async () => {
		const host = createHost();
		const camera = await join('camera');
		await join('monitor');
		await goLive(camera);

		camera.route('all', 'program', 'cam1');
		camera.setStatus({ recording: true }); // 後続のメッセージが届いたことを目印にする
		await expect.poll(() => host.snapshot.nodes[0].recording).toBe(true);
		expect(host.snapshot.routes[0].program).toBeNull();
	});

	it('ホストが終了すると端末は切断を検知し、新しいホストにつなぎ直せる', async () => {
		const host = createHost();
		const monitor = await join('monitor');

		host.destroy();
		await expect.poll(() => monitor.connected).toBe(false);
		expect(monitor.lost).toBe(true);

		createHost();
		const finder = new LocalHostFinder();
		cleanups.push(() => finder.close());
		await monitor.pairing.start();
		await expect.poll(() => finder.available).toBe(true);
		expect(await finder.connect(monitor.pairing)).toBe(true);
		await expect.poll(() => monitor.connected).toBe(true);
		expect(monitor.lost).toBe(false);
	});
});
