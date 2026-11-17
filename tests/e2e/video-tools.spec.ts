import { expect, test, type Page } from '@playwright/test';
import { expectMonitorShowsVideo, join, openHost, startCamera } from './helpers';

/**
 * 画面の合成（ワイプ・2画面・テロップ重ね）、通信の状態の表示、カメラの遠隔ズームのテスト
 */

/** モニターの画面に、いま見えている映像の置き方を調べる */
function visibleVideos(monitor: Page) {
	return monitor.evaluate(() =>
		[...document.querySelectorAll('video')]
			.filter((video) => getComputedStyle(video).opacity === '1' && video.videoWidth > 0 && !video.paused)
			.map((video) => {
				const box = video.getBoundingClientRect();
				return {
					widthRatio: Math.round((box.width / window.innerWidth) * 100),
					left: Math.round((box.left / window.innerWidth) * 100),
					blend: getComputedStyle(video).mixBlendMode
				};
			})
			.sort((a, b) => b.widthRatio - a.widthRatio || a.left - b.left)
	);
}

test('ワイプ・2画面・テロップ重ねで、2つの映像を1台のモニターに出せる', async ({ context }) => {
	const host = await openHost(context);
	const camera1 = await join(context, '/camera/', 'カメラ 1');
	const camera2 = await join(context, '/camera/', 'カメラ 2');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera1);
	await startCamera(camera2);
	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);
	await expect(camera2.getByText('待機中')).toBeVisible();

	// ワイプ: 本番の映像の隅に、もう1つの映像が小さく出る
	await controller.getByRole('button', { name: /^ワイプ/ }).click();
	await expect.poll(() => visibleVideos(monitor), { timeout: 20_000 }).toHaveLength(2);
	let videos = await visibleVideos(monitor);
	expect(videos[0].widthRatio).toBe(100);
	expect(videos[1].widthRatio).toBeGreaterThan(20);
	expect(videos[1].widthRatio).toBeLessThan(35);
	expect(videos[1].left).toBeGreaterThan(60);
	// 重ねているカメラにも「本番中」が出る
	await expect(camera2.getByText('● 本番中')).toBeVisible();
	await expect(controller.getByText('重ね', { exact: true })).toBeVisible();
	await expect(host.getByRole('button', { name: /^ワイプ/ })).toHaveAttribute('aria-pressed', 'true');

	// 2画面: 左右に半分ずつ
	await controller.getByRole('button', { name: /^2画面/ }).click();
	await expect
		.poll(async () => (await visibleVideos(monitor)).map((video) => [video.widthRatio, video.left]))
		.toEqual([
			[50, 0],
			[50, 50]
		]);

	// テロップ重ね: 黒い部分を透かして、全面に重ねる
	await controller.getByRole('button', { name: /^テロップを重ねる/ }).click();
	await expect
		.poll(async () => (await visibleVideos(monitor)).map((video) => video.blend).sort())
		.toEqual(['normal', 'screen']);
	videos = await visibleVideos(monitor);
	expect(videos.map((video) => video.widthRatio)).toEqual([100, 100]);

	// 1画面に戻すと、重ねていたカメラは待機に戻る
	await controller.getByRole('button', { name: /^1画面/ }).click();
	await expect.poll(() => visibleVideos(monitor)).toHaveLength(1);
	await expect(camera2.getByText('待機中')).toBeVisible();
});

test('通信の状態を、相手ごとに確かめられる', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	// カメラの画面: 送り先ごとに、経路と通信量が出る
	await camera.getByText('通信の状態').click();
	const row = camera.getByRole('row').filter({ hasText: 'モニター 1' });
	await expect(row).toContainText('直接', { timeout: 20_000 });
	await expect(row).toContainText(/\d+(\.\d)? (kbps|Mbps)/, { timeout: 20_000 });
	await expect(row).toContainText('コマ/秒');
	await expect(camera.getByRole('row').filter({ hasText: 'ホスト（確認用）' })).toBeVisible();

	// モニターの画面: 受けている映像の状態が出る
	await monitor.mouse.move(200, 200);
	await monitor.getByRole('button', { name: 'その他' }).click();
	await monitor.getByText('通信の状態').click();
	await expect(monitor.getByRole('row').filter({ hasText: 'カメラ 1' })).toContainText('直接', {
		timeout: 20_000
	});
});

test('スイッチャーから、カメラのズームを操作できる（対応しているカメラのみ）', async ({ context }) => {
	await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera);

	// テスト用のカメラがズームに対応していない環境では、このテストは行わない
	const slider = camera.getByRole('slider');
	const supported = await slider
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	test.skip(!supported, 'テスト用のカメラがズームに対応していない');

	const min = Number(await slider.getAttribute('min'));
	const max = Number(await slider.getAttribute('max'));
	await controller.getByRole('button', { name: '設定' }).click();
	const remote = controller.getByLabel('カメラ 1 のズーム');
	await expect(remote).toBeVisible();
	await remote.fill(String(max));

	// カメラ端末の実際のズームが変わり、スイッチャーの表示にも返ってくる
	await expect
		.poll(() => camera.evaluate(() => {
			const video = document.querySelector('video');
			const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
			return (track?.getSettings() as { zoom?: number } | undefined)?.zoom ?? null;
		}))
		.toBe(max);
	await expect(slider).toHaveValue(String(max));
	expect(max).toBeGreaterThan(min);
});
