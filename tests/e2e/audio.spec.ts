import { expect, test } from '@playwright/test';
import { expectMonitorShowsVideo, join, openHost, startCamera } from './helpers';

/**
 * 音声まわりの操作のテスト
 *
 * テスト用のカメラは、一定間隔で「ピッ」という音を出すマイクも備えている。
 */

test('カメラの画面で、音量を確かめ、消音と音の送り方を切り替えられる', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	// マイクに音が入ると、メーターが動く
	const meter = camera.getByRole('meter', { name: '音の大きさ' });
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 20_000 }).toBeGreaterThan(5);

	// 消音すると、ホストの一覧にも出る。メーターは下がる
	await camera.getByRole('button', { name: 'マイクを消音する' }).click();
	await expect(camera.getByText('マイク消音中')).toBeVisible();
	await expect(host.getByText('マイク消音中')).toBeVisible();
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 20_000 }).toBeLessThan(3);
	await camera.getByRole('button', { name: '消音を解除する' }).click();
	await expect(host.getByText('マイク消音中')).toBeHidden();

	// 音楽向けに切り替えても、映像は出続ける（接続を張り直す）
	await camera.getByRole('button', { name: /音楽向け/ }).click();
	await expect(camera.getByRole('button', { name: /音楽向け/ })).toHaveAttribute('aria-pressed', 'true');
	await expect(camera.getByText(/ハウリング/)).toBeVisible();
	await expectMonitorShowsVideo(monitor);

	// 選んだ送り方は、ページを開き直しても覚えている
	camera.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
	await camera.reload();
	await startCamera(camera);
	await expect(camera.getByRole('button', { name: /音楽向け/ })).toHaveAttribute('aria-pressed', 'true');
});

test('スイッチャーから、カメラのマイクとモニターの音を操作できる', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera);
	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	// モニターの音は、最初は消してある
	const isAudible = () =>
		monitor.evaluate(() =>
			[...document.querySelectorAll('video')].some(
				(video) => !video.muted && getComputedStyle(video).opacity === '1'
			)
		);
	expect(await isAudible()).toBe(false);

	// スイッチャーから音を出す
	await controller.getByRole('button', { name: 'モニター 1 の音を出す' }).click();
	await expect.poll(isAudible).toBe(true);
	await expect(controller.getByRole('button', { name: 'モニター 1 の音を消す' })).toBeVisible();
	await expect(host.getByRole('button', { name: 'モニター 1 の音を消す' })).toBeVisible();

	// モニターの画面で消すと、スイッチャーの表示も戻る
	await monitor.mouse.move(200, 200);
	await monitor.getByRole('button', { name: '音を消す' }).click();
	await expect(controller.getByRole('button', { name: 'モニター 1 の音を出す' })).toBeVisible();

	// カメラのマイクを、スイッチャーから消音する
	await controller.getByRole('button', { name: '設定' }).click();
	await controller.getByRole('button', { name: 'マイクを消音する' }).click();
	await expect(camera.getByRole('button', { name: '消音を解除する' })).toBeVisible();
	await expect(controller.getByText('マイク消音中')).toBeVisible();
	await controller.getByRole('button', { name: 'マイクの消音を解除する' }).click();
	await expect(camera.getByRole('button', { name: 'マイクを消音する' })).toBeVisible();

	// 音の送り方も、スイッチャーから変えられる
	await controller.getByRole('button', { name: '音楽向け', exact: true }).click();
	await expect(camera.getByRole('button', { name: /音楽向け/ })).toHaveAttribute('aria-pressed', 'true');
	await expect(controller.getByRole('button', { name: '音楽向け', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expectMonitorShowsVideo(monitor);
});
