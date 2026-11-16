import { expect, test } from '@playwright/test';
import {
	expectMonitorShowsVideo,
	expectPlayingVideos,
	join,
	openHost,
	startCamera
} from './helpers';

test('トップページで役割を選べる', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'この端末の役割を選んでください' })).toBeVisible();
	for (const title of ['ホスト', 'カメラ', 'テロップ', 'モニター', 'スイッチャー']) {
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
	}

	await page.getByRole('link', { name: /スイッチャー/ }).click();
	await expect(page).toHaveURL(/\/controller\/$/);
	await expect(page.getByRole('heading', { name: 'ホストとつなぐ' })).toBeVisible();
});

test('端末をつなぎ、スイッチャーで選んだカメラの映像がモニターに映る', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');

	// ホストの一覧に、つないだ端末が並ぶ
	await expect(host.getByText('3台とつながっています')).toBeVisible();
	await expect(host.getByText('映像の準備中')).toBeVisible();

	// カメラを始めると、ホストとスイッチャーに確認用の映像が届く
	await startCamera(camera);
	await expect(camera.getByText('待機中')).toBeVisible();
	await expect(host.getByText('映像を送れます')).toBeVisible();
	await expectPlayingVideos(controller, 1);
	await expectPlayingVideos(host, 1);

	// モニターは、選ばれるまで何も映さない
	await expect(monitor.getByText('映像を待っています')).toBeVisible();

	// スイッチャーでカメラを選ぶと、モニターに映る
	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);
	await expect(monitor.getByText('「カメラ 1」を表示中')).toBeAttached();

	// カメラ側には「本番中」と出る（赤ランプ）
	await expect(camera.getByText('● 本番中')).toBeVisible();
	await expect(camera.getByText('モニター 1 に映っています')).toBeVisible();
	await expect(host.getByText('「カメラ 1」を表示中')).toBeVisible();

	// 黒画面に戻せる
	await controller.getByRole('button', { name: '何も映さない' }).click();
	await expect(monitor.getByText('映像を待っています')).toBeVisible();
	await expect(camera.getByText('待機中')).toBeVisible();
});

test('予告してから切り替える（2段階切替）と、全モニターの一括切替', async ({ context }) => {
	const host = await openHost(context);
	const camera1 = await join(context, '/camera/', 'カメラ 1');
	const camera2 = await join(context, '/camera/', 'カメラ 2');
	const monitor1 = await join(context, '/monitor/', 'モニター 1');
	const monitor2 = await join(context, '/monitor/', 'モニター 2');
	await startCamera(camera1);
	await startCamera(camera2);

	// ホストの画面から、全モニターにカメラ 1 を出す
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor1);
	await expectMonitorShowsVideo(monitor2);
	await expect(camera1.getByText('モニター 1、モニター 2 に映っています')).toBeVisible();

	// 予告方式に切り替えて、カメラ 2 を予告に入れる。まだ本番は変わらない
	await host.getByRole('button', { name: '予告してから切り替える' }).click();
	await host.getByRole('button', { name: 'カメラ 2 を予告に入れる' }).click();
	await expect(camera2.getByText('予告', { exact: true })).toBeVisible();
	await expect(camera1.getByText('● 本番中')).toBeVisible();
	await expect(monitor1.getByText('「カメラ 1」を表示中')).toBeAttached();

	// 「切り替える」で、予告が本番に出る
	await host.getByRole('button', { name: '切り替える', exact: true }).click();
	await expect(camera2.getByText('● 本番中')).toBeVisible();
	await expect(monitor1.getByText('「カメラ 2」を表示中')).toBeAttached();
	await expect(monitor2.getByText('「カメラ 2」を表示中')).toBeAttached();
	await expectMonitorShowsVideo(monitor1);

	// モニターを1台だけ選んで切り替える
	await host.getByRole('button', { name: '押したらすぐ切り替える' }).click();
	await host.getByRole('button', { name: /^モニター 2/ }).click();
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expect(monitor2.getByText('「カメラ 1」を表示中')).toBeAttached();
	await expect(monitor1.getByText('「カメラ 2」を表示中')).toBeAttached();
});

test('テロップで出した文字が、映像としてモニターに映る', async ({ context }) => {
	const host = await openHost(context);
	const admin = await join(context, '/admin/', 'テロップ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');

	await admin.getByLabel('大きく出す文字').fill('3年A組 合唱');
	await admin.getByLabel('小さく出す文字').fill('旅立ちの日に');
	await admin.getByRole('button', { name: 'この文字を出す' }).click();
	await expect(admin.getByText('↑ いま出している内容')).toBeVisible();

	await host.getByRole('button', { name: 'テロップ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);
	await expect(admin.getByText('● 本番中')).toBeVisible();

	// 歌詞を登録して、1行ずつ送る
	await admin.getByRole('tab', { name: '歌詞' }).click();
	await admin.getByLabel(/歌詞を貼り付けてください/).fill('白い光の中に\n山なみは萌えて');
	await admin.getByRole('button', { name: '歌詞を決定して、送り出しへ進む' }).click();
	await admin.getByRole('button', { name: '最初の行を出す' }).click();
	await admin.keyboard.press('ArrowDown');
	await expect(admin.getByRole('button', { name: '次の行へ' })).toBeDisabled();

	// タイムテーブルに登録した演目を出す
	await admin.getByRole('tab', { name: 'タイムテーブル' }).click();
	await admin.getByRole('button', { name: '＋ 演目を追加' }).click();
	await admin.getByLabel('演目名').fill('吹奏楽部');
	await admin.getByRole('button', { name: '最初の演目を出す' }).click();
	await expect(admin.getByRole('button', { name: 'もう一度出す' })).toBeVisible();

	// 入力した内容は端末に保存され、開き直しても残る
	admin.on('dialog', (dialog) => void dialog.accept());
	await admin.reload();
	await admin.getByRole('button', { name: 'この端末のホストにつなぐ' }).click();
	await expect(admin.getByLabel('大きく出す文字')).toHaveValue('3年A組 合唱');
});

test('カメラが使えないときは、コードを貼り付けてつなげる', async ({ context }) => {
	const host = await openHost(context);
	const monitor = await context.newPage();
	await monitor.goto('/monitor/');

	for (const page of [host, monitor]) {
		await page.getByText('カメラが使えないとき').click();
		await expect(page.locator('#own-code')).not.toHaveValue('');
	}
	const hostCode = await host.locator('#own-code').inputValue();
	const monitorCode = await monitor.locator('#own-code').inputValue();
	// QR に入れる文字列は、英数字モードで使える文字だけでできている
	expect(hostCode).toMatch(/^[0-9A-Z $%*+\-./:]+$/);

	await monitor.locator('#partner-code').fill(hostCode);
	await monitor.getByRole('button', { name: 'このコードでつなぐ' }).click();
	await expect(monitor.getByText(/ホストの QR コードを読み取りました/)).toBeVisible();

	await host.locator('#partner-code').fill(monitorCode);
	await host.getByRole('button', { name: 'このコードでつなぐ' }).click();

	await expect(host.getByText('1台とつながっています')).toBeVisible();
	await expect(monitor.getByText('映像を待っています')).toBeVisible();

	// 違う文字を貼り付けても、分かる言葉で知らせて、そのまま続けられる
	await host.locator('#partner-code').fill('https://example.com');
	await host.getByRole('button', { name: 'このコードでつなぐ' }).click();
	await expect(host.getByRole('alert').filter({ hasText: 'CHARM Point の QR コードではありません' })).toBeVisible();
});

test('録画はホストが許可したときだけでき、ファイルとして保存される', async ({ context }) => {
	// 保存先を選ぶ画面は自動操作できないので、ダウンロードとして保存する経路で確かめる
	await context.addInitScript(() => {
		// @ts-expect-error テストのために、保存先を選ぶ機能がないブラウザのふりをする
		delete window.showSaveFilePicker;
	});
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	await startCamera(camera);

	await expect(camera.getByRole('button', { name: '録画を始める' })).toHaveCount(0);
	await host.getByLabel('録画を許可する').check();

	await camera.getByRole('button', { name: '録画を始める' }).click();
	await expect(camera.getByText('録画中')).toBeVisible();
	await expect(host.getByText('● 録画中').first()).toBeVisible();

	await camera.waitForTimeout(2500);
	const download = camera.waitForEvent('download');
	await camera.getByRole('button', { name: '録画を止めて保存' }).click();
	expect((await download).suggestedFilename()).toMatch(/^カメラ_1_\d{4}-\d{2}-\d{2}_.+\.(mp4|webm)$/);
	await expect(host.getByText('● 録画中')).toHaveCount(0);

	// 許可を取り消すと、録画ボタンが消える
	await host.getByLabel('録画を許可する').uncheck();
	await expect(camera.getByRole('button', { name: '録画を始める' })).toHaveCount(0);
});

test('スイッチャーからカメラの画質と名前を遠隔で変えられる', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera);

	await controller.getByRole('button', { name: '設定' }).click();
	await controller.getByRole('button', { name: /^軽い/ }).click();
	await expect(camera.getByRole('button', { name: /^軽い/ })).toHaveAttribute('aria-pressed', 'true');

	await controller.getByLabel('名前').fill('体育館ステージ');
	await controller.getByRole('button', { name: '変更' }).click();
	await expect(camera.getByText('体育館ステージ').first()).toBeVisible();
	await expect(host.getByText('体育館ステージ').first()).toBeVisible();
});

test('ホストが閉じても、モニターは映像を出し続け、つなぎ直しを案内する', async ({ context }) => {
	const host = await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	host.on('dialog', (dialog) => void dialog.accept());
	await host.close({ runBeforeUnload: false });

	await expect(monitor.getByText(/ホストとの接続が切れました/)).toBeVisible();
	await expectMonitorShowsVideo(monitor);
	await expect(camera.getByText('ホストとの接続が切れました。')).toBeVisible();

	// 新しいホストを開けば、つなぎ直せる
	await openHost(context);
	await monitor.getByRole('button', { name: 'ホストとつなぎ直す' }).click();
	await monitor.getByRole('button', { name: 'この端末のホストにつなぐ' }).click();
	await expect(monitor.getByText('映像を待っています')).toBeVisible();
});

test('ホストの画面から端末を切断できる（確認つき）', async ({ context }) => {
	const host = await openHost(context);
	const monitor = await join(context, '/monitor/', 'モニター 1');

	// 確認で「キャンセル」を選ぶと、切断しない
	host.once('dialog', (dialog) => void dialog.dismiss());
	await host.getByRole('button', { name: '切断' }).click();
	await expect(host.getByText('1台とつながっています')).toBeVisible();

	host.once('dialog', (dialog) => void dialog.accept());
	await host.getByRole('button', { name: '切断' }).click();
	await expect(host.getByText('0台とつながっています')).toBeVisible();
	await expect(monitor.getByText(/ホストとの接続が切れました/)).toBeVisible();
});

test('一度開いたあとは、インターネットなしでも全ページを開ける', async ({ context, page }) => {
	await page.goto('/');
	// アプリ一式が端末に保存されるのを待つ
	await expect(page.getByText('オフラインで使えます')).toBeVisible({ timeout: 30_000 });

	await context.setOffline(true);
	for (const [path, heading] of [
		['/host/', '端末をつなぐ'],
		['/camera/', 'ホストとつなぐ'],
		['/admin/', 'ホストとつなぐ'],
		['/monitor/', 'ホストとつなぐ'],
		['/controller/', 'ホストとつなぐ'],
		['/', 'この端末の役割を選んでください']
	]) {
		await page.goto(path);
		await expect(page.getByRole('heading', { name: heading })).toBeVisible();
	}
	// QR コードの生成と読み取り用の部品も、保存済みのものだけで動く
	await page.goto('/monitor/');
	await expect(page.getByLabel('この端末の QR コード')).toBeVisible();
});
