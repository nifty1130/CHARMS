/**
 * 説明書（README）に載せる画面写真を撮る
 *
 * 実際にホストと端末をつないだ状態を作ってから撮るので、画面が変わったら
 * `npm run screenshots` で撮り直せる。ふだんのテストでは実行しない。
 */

import { expect, test, type Page } from '@playwright/test';
import { expectMonitorShowsVideo, expectPlayingVideos, join, openHost, startCamera } from './helpers';

const DIR = 'docs/screenshots';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
	await page.bringToFront();
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

test('画面写真を撮る', async ({ context }) => {
	test.setTimeout(180_000);

	// トップページ
	const home = await context.newPage();
	await home.setViewportSize(DESKTOP);
	await home.goto('/');
	await expect(home.getByRole('heading', { name: 'この端末の役割を選んでください' })).toBeVisible();
	await shot(home, '01-home');
	await home.setViewportSize(PHONE);
	await shot(home, '01-home-phone');
	await home.close();

	// ホスト（端末をつなぐ前）
	const host = await openHost(context);
	await host.setViewportSize(DESKTOP);
	await expect(host.getByLabel('この端末の QR コード')).toBeVisible();
	await expect(host.getByTestId('room-code')).toBeVisible();
	await shot(host, '02-host-connect');
	await shot(host, '02-host-connect-full', true);

	// スマホでの接続画面
	const phone = await context.newPage();
	await phone.setViewportSize(PHONE);
	await phone.goto('/camera/');
	await expect(phone.getByLabel('この端末の QR コード')).toBeVisible();
	await shot(phone, '03-connect-phone', true);
	await phone.close();

	// 端末をつなぐ
	const camera1 = await join(context, '/camera/', 'カメラ 1');
	const camera2 = await join(context, '/camera/', 'カメラ 2');
	const admin = await join(context, '/admin/', 'テロップ 1');
	const monitor1 = await join(context, '/monitor/', 'モニター 1');
	const monitor2 = await join(context, '/monitor/', 'モニター 2');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	for (const page of [camera1, camera2, admin, monitor1, monitor2, controller]) {
		await page.setViewportSize(DESKTOP);
	}

	// カメラ（映像を選ぶ前）
	await shot(camera1, '04-camera-choose');
	await startCamera(camera1);
	await startCamera(camera2);

	// 名前を付ける
	await host.getByRole('button', { name: '追加を終わる' }).click();
	host.on('dialog', (dialog) => void dialog.accept());
	const rename = async (from: string, to: string) => {
		const item = host.getByRole('listitem').filter({ hasText: from });
		await item.getByRole('button', { name: '名前' }).click();
		await host.getByLabel('名前', { exact: true }).fill(to);
		await host.getByRole('button', { name: '決定' }).click();
		await expect(host.getByRole('listitem').filter({ hasText: to })).toBeVisible();
	};
	await rename('カメラ 1', 'ステージ正面');
	await rename('カメラ 2', '客席うしろ');
	await rename('モニター 1', '体育館スクリーン');
	await rename('モニター 2', 'ロビーのテレビ');

	// テロップ
	await admin.getByLabel('大きく出す文字').fill('3年A組 合唱');
	await admin.getByLabel('小さく出す文字').fill('「旅立ちの日に」');
	await admin.getByRole('button', { name: 'この文字を出す' }).click();
	await shot(admin, '07-admin-title');

	// スイッチャー: 予告してから切り替える
	await expectPlayingVideos(controller, 3);
	await controller.getByRole('button', { name: 'ステージ正面 を映す' }).click();
	await expectMonitorShowsVideo(monitor1);
	await controller.getByRole('button', { name: '予告してから切り替える' }).click();
	await controller.getByRole('button', { name: 'テロップ 1 を予告に入れる' }).click();
	await expect(admin.getByText('予告', { exact: true })).toBeVisible();
	await shot(controller, '06-controller');

	// カメラ（本番中）
	await expect(camera1.getByText('● 本番中')).toBeVisible();
	await shot(camera1, '05-camera-live');

	// テロップ（歌詞の送り出し）
	await admin.getByRole('tab', { name: '歌詞' }).click();
	await admin.getByLabel('曲名').fill('旅立ちの日に');
	await admin
		.getByLabel(/歌詞を貼り付けてください/)
		.fill('白い光の中に\n山なみは萌えて\n遥かな空の果てまでも\n君は飛び立つ\n\n限りなく青い空に\n心ふるわせ');
	await admin.getByRole('button', { name: '歌詞を決定して、送り出しへ進む' }).click();
	await admin.getByRole('button', { name: '最初の行を出す' }).click();
	await admin.getByRole('button', { name: '次の行へ' }).click();
	await shot(admin, '08-admin-lyrics');

	// モニター（映像を表示中。操作パネルを出した状態）
	await monitor1.mouse.move(200, 200);
	await shot(monitor1, '09-monitor');

	// ホスト（全体）
	await expectPlayingVideos(host, 3);
	await shot(host, '10-host-overview', true);
});
