import { expect, test, type Page } from '@playwright/test';
import { expectMonitorShowsVideo, join, openHost, startCamera } from './helpers';

/**
 * スタッフの連携のテスト: 指示メッセージ、インカム、録画の一斉操作
 */

test('スイッチャーやホストから、カメラ担当の画面に指示を出せる', async ({ context }) => {
	const host = await openHost(context);
	const camera1 = await join(context, '/camera/', 'カメラ 1');
	const camera2 = await join(context, '/camera/', 'カメラ 2');
	const controller = await join(context, '/controller/', 'スイッチャー 1');

	// よく使う指示を、全員に送る
	await controller.getByRole('button', { name: '寄って', exact: true }).click();
	for (const camera of [camera1, camera2]) {
		const alert = camera.getByRole('alert').filter({ hasText: 'からの指示' });
		await expect(alert).toContainText('スイッチャー 1 からの指示');
		await expect(alert).toContainText('寄って');
	}
	await expect(controller.getByText('全員に「寄って」と送りました')).toBeVisible();

	// 「了解」で消える
	await camera1.getByRole('button', { name: '了解' }).click();
	await expect(camera1.getByRole('alert').filter({ hasText: 'からの指示' })).toBeHidden();

	// ホストから、1台だけに自由な文で送る
	await host.getByLabel('送り先').selectOption({ label: 'カメラ 2' });
	await host.getByLabel('指示の内容').fill('3曲目の頭でステージ全体');
	await host.getByRole('button', { name: '送る', exact: true }).click();
	await expect(camera2.getByRole('alert').filter({ hasText: 'ホスト からの指示' })).toContainText(
		'3曲目の頭でステージ全体'
	);
	await expect(camera1.getByRole('alert').filter({ hasText: 'からの指示' })).toBeHidden();
});

/** ページの中で、インカムの声が鳴っているか */
function hearsVoice(page: Page): Promise<boolean> {
	return page.evaluate(() =>
		[...document.querySelectorAll('audio')].some((audio) => {
			const stream = audio.srcObject as MediaStream | null;
			return !audio.paused && !!stream?.getAudioTracks().some((track) => track.readyState === 'live');
		})
	);
}

test('インカム: スイッチャーの声が、聞く設定にしたカメラにだけ届く', async ({ context }) => {
	await openHost(context);
	const camera1 = await join(context, '/camera/', 'カメラ 1');
	const camera2 = await join(context, '/camera/', 'カメラ 2');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera1);
	await startCamera(camera2);

	await expect(controller.getByText('聞いている端末はありません')).toBeVisible();
	await camera1.getByRole('checkbox', { name: /インカムを聞く/ }).check();
	await expect(controller.getByText('聞いている端末: カメラ 1')).toBeVisible();

	// インカムを入れると、聞く設定にしたカメラにだけ声が届く
	await controller.getByRole('button', { name: 'インカムを入れる' }).click();
	await expect(controller.getByText(/マイクの声が、聞いている端末に届いています/)).toBeVisible();
	await expect.poll(() => hearsVoice(camera1), { timeout: 20_000 }).toBe(true);
	expect(await hearsVoice(camera2)).toBe(false);

	// 切ると、声は止まる
	await controller.getByRole('button', { name: 'インカムを切る' }).click();
	await expect.poll(() => hearsVoice(camera1), { timeout: 20_000 }).toBe(false);
});

/**
 * 端末の録画が、指定した秒数以上続くまで待つ
 *
 * 録画を始めてすぐ止めると、遅い端末（CI など）では、映像の圧縮が最初のデータを作り終えず、
 * 保存するものがないことがある。本番ではありえない短さなので、テストでは少し録画してから止める。
 */
async function recordFor(page: Page, seconds: number): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const status = [...document.querySelectorAll('[role="status"]')].find((element) =>
						element.textContent?.includes('録画中')
					);
					const match = status?.textContent?.match(/(\d+):(\d{2})/);
					return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
				}),
			{ timeout: 20_000 }
		)
		.toBeGreaterThanOrEqual(seconds);
}

test('スイッチャーから、全端末の録画をまとめて始めて止められる', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera);
	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	// 録画を許可していない間は、操作が出ない
	await expect(controller.getByRole('button', { name: /全端末で録画を始める/ })).toHaveCount(0);
	await host.getByRole('checkbox', { name: /録画を許可する/ }).check();

	await controller.getByRole('button', { name: /全端末で録画を始める/ }).click();
	await expect(controller.getByText('2台が録画中')).toBeVisible({ timeout: 20_000 });
	await expect(camera.getByRole('button', { name: /録画を止めて保存/ })).toBeVisible();
	await recordFor(camera, 2);
	await recordFor(monitor, 2);

	// 止めると、それぞれの端末にファイルが保存される
	const downloads = Promise.all([camera.waitForEvent('download'), monitor.waitForEvent('download')]);
	await controller.getByRole('button', { name: /全端末の録画を止める/ }).click();
	const [fromCamera, fromMonitor] = await downloads;
	expect(fromCamera.suggestedFilename()).toMatch(/^カメラ_1_.*\.(webm|mp4)$/);
	expect(fromMonitor.suggestedFilename()).toMatch(/^モニター_1_.*\.(webm|mp4)$/);
	await expect(controller.getByText('録画中の端末はありません')).toBeVisible();
});

test('画面に触れていないモニター（ブラウザが音を止めている）でも、一斉録画のファイルが保存される', async ({
	context
}) => {
	const host = await openHost(context);
	const code = (await host.getByTestId('room-code').innerText()).replace(/\s/g, '');
	const camera = await join(context, '/camera/', 'カメラ 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');

	// 招待リンクで自動でつながり、一度も触れていないモニター。
	// 音をまとめる仕組みが止まったままで、webm 形式で録画するブラウザ（Android・Linux の Chrome など）のまねをする
	const monitor = await context.newPage();
	await monitor.addInitScript(() => {
		const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
		MediaRecorder.isTypeSupported = (type: string) => !type.startsWith('video/mp4') && supported(type);
		const Original = window.AudioContext;
		window.AudioContext = class extends Original {
			constructor(options?: AudioContextOptions) {
				super(options);
				void this.suspend();
				this.resume = async () => {};
			}
		};
	});
	await monitor.goto(`/monitor/?room=${code}`);
	await startCamera(camera);
	await expect(host.getByText('3台とつながっています')).toBeVisible({ timeout: 30_000 });
	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	await host.getByRole('checkbox', { name: /録画を許可する/ }).check();
	await controller.getByRole('button', { name: /全端末で録画を始める/ }).click();
	await expect(controller.getByText('2台が録画中')).toBeVisible({ timeout: 20_000 });
	// 音なしで録画していることを、モニターの画面で知らせる
	await expect(monitor.getByText(/音なしで録画しています/)).toBeAttached();
	await recordFor(monitor, 2);

	const download = monitor.waitForEvent('download');
	await controller.getByRole('button', { name: /全端末の録画を止める/ }).click();
	expect((await download).suggestedFilename()).toMatch(/^モニター_1_.*\.webm$/);
});
