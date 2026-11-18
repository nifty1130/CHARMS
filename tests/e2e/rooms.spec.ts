import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectMonitorShowsVideo, openHost, startCamera } from './helpers';

/**
 * 合言葉・招待リンクでつなぐ機能のテスト
 *
 * 配信元の「ルーム」（Worker）を通して接続情報を受け渡すので、QR コードも、
 * 同じ端末用の近道（「この端末のホストにつなぐ」）も使わずにつながることを確かめる。
 */

/** ホストの画面に出ている合言葉を読む */
async function roomCode(host: Page): Promise<string> {
	const text = await host.getByTestId('room-code').innerText();
	return text.replace(/\s/g, '');
}

/** 役割のページを開き、合言葉を入力してつなぐ */
async function joinByCode(
	context: BrowserContext,
	path: string,
	code: string,
	name: string
): Promise<Page> {
	const page = await context.newPage();
	await page.goto(path);
	await page.getByLabel(/6桁の合言葉/).fill(code);
	await page.getByRole('button', { name: 'つなぐ', exact: true }).click();
	if (path.startsWith('/monitor/')) {
		await expect(page.getByText(name).first()).toBeVisible();
	} else {
		await expect(page.getByRole('status').filter({ hasText: name })).toBeVisible();
	}
	return page;
}

/** 読み込み直すときに出る「このページを離れますか？」に「はい」と答える */
function acceptLeaving(page: Page): void {
	page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
}

test('合言葉を入力すると、QR コードなしでつながり、映像が映る', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	expect(code).toMatch(/^\d{6}$/);

	// 全角の数字や、区切りの空白が入っていても受け付ける
	const spaced = `${code.slice(0, 3)}　${code.slice(3)}`.replace(/\d/g, (digit) =>
		String.fromCharCode(digit.charCodeAt(0) + 0xfee0)
	);
	const camera = await joinByCode(context, '/camera/', spaced, 'カメラ 1');
	const monitor = await joinByCode(context, '/monitor/', code, 'モニター 1');
	await expect(host.getByText('2台とつながっています')).toBeVisible();

	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);
});

test('招待リンクを開いて役割を選ぶと、自動でつながる', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);

	const page = await context.newPage();
	await page.goto(`/?room=${code}`);
	await expect(page.getByText(/招待リンクから開きました/)).toBeVisible();
	await page.getByRole('link', { name: /スイッチャー/ }).click();

	await expect(page.getByRole('status').filter({ hasText: 'スイッチャー 1' })).toBeVisible();
	await expect(host.getByText('1台とつながっています')).toBeVisible();
});

test('合言葉が違うときは待ち続け、やめることができる', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	const wrong = code === '000000' ? '000001' : '000000';

	const page = await context.newPage();
	await page.goto('/camera/');
	await page.getByLabel(/6桁の合言葉/).fill('12345');
	await page.getByRole('button', { name: 'つなぐ', exact: true }).click();
	await expect(page.getByText('合言葉は6桁の数字です。')).toBeVisible();

	await page.getByLabel(/6桁の合言葉/).fill(wrong);
	await page.getByRole('button', { name: 'つなぐ', exact: true }).click();
	await expect(page.getByText(/まだ開かれていません/)).toBeVisible();

	await page.getByRole('button', { name: 'やめる' }).click();
	await expect(page.getByLabel(/6桁の合言葉/)).toBeVisible();
});

test('端末のページを読み込み直しても、同じ端末として自動で戻る', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	const camera = await joinByCode(context, '/camera/', code, 'カメラ 1');
	const monitor = await joinByCode(context, '/monitor/', code, 'モニター 1');
	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	acceptLeaving(monitor);
	await monitor.reload();

	// 「モニター 2」ではなく「モニター 1」として戻り、映していた映像もそのまま出る
	await expect(host.getByText('「カメラ 1」を表示中')).toBeVisible({ timeout: 30_000 });
	await expect(host.getByText('2台とつながっています')).toBeVisible();
	await expect(host.getByText('モニター 2')).toHaveCount(0);
	await host.getByText(/接続の記録/).click();
	await expect(host.locator('details').getByText('モニター 1 がつなぎ直しました')).toBeVisible();
	await expect(host.getByText('「カメラ 1」を表示中')).toBeVisible();
	await expectMonitorShowsVideo(monitor);
});

test('インカムを聞いていたカメラが読み込み直すと、「聞かない」に戻り、声も流れない', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	const camera = await joinByCode(context, '/camera/', code, 'カメラ 1');
	const controller = await joinByCode(context, '/controller/', code, 'スイッチャー 1');
	await startCamera(camera);

	await camera.getByRole('checkbox', { name: /インカムを聞く/ }).check();
	await expect(controller.getByText('聞いている端末: カメラ 1')).toBeVisible();
	await controller.getByRole('button', { name: 'インカムを入れる' }).click();
	await expect(controller.getByText(/マイクの声が、聞いている端末に届いています/)).toBeVisible();
	await expect.poll(() => audioCount(camera), { timeout: 20_000 }).toBe(1);

	acceptLeaving(camera);
	await camera.reload();
	await expect(camera.getByRole('status').filter({ hasText: 'カメラ 1' })).toBeVisible({ timeout: 30_000 });
	await startCamera(camera);

	// カメラの画面は「聞かない」に戻る。スイッチャーにも、ホストが覚えていた古い状態は出ない
	await expect(camera.getByRole('checkbox', { name: /インカムを聞く/ })).not.toBeChecked();
	await expect(controller.getByText('聞いている端末はありません')).toBeVisible();
	// 声の接続は張られない（少し待って、届かないことを確かめる）
	await camera.waitForTimeout(3000);
	expect(await audioCount(camera)).toBe(0);
});

/** インカムの声を鳴らすための audio 要素の数 */
async function audioCount(page: Page): Promise<number> {
	return page.locator('audio').count();
}

test('ホストのページを読み込み直しても、端末が自動で戻り、映像の割り当ても元に戻る', async ({
	context
}) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	const camera = await joinByCode(context, '/camera/', code, 'カメラ 1');
	const monitor = await joinByCode(context, '/monitor/', code, 'モニター 1');
	await startCamera(camera);
	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);

	acceptLeaving(host);
	await host.reload();

	// 合言葉は変わらない
	await expect(host.getByTestId('room-code')).toBeVisible();
	expect(await roomCode(host)).toBe(code);

	await expect(host.getByText('2台とつながっています')).toBeVisible({ timeout: 30_000 });
	await expect(host.getByText('「カメラ 1」を表示中')).toBeVisible();
	await expectMonitorShowsVideo(monitor);
	await expect(camera.getByText('カメラで撮影中')).toBeVisible();
});

test('配信ソフト用のリンクは、操作パネルのない映像だけのモニターになる', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	const camera = await joinByCode(context, '/camera/', code, 'カメラ 1');
	await startCamera(camera);

	await host.getByText('OBS などの配信ソフトに映像を取り込む').click();
	const link = await host.getByLabel('配信ソフト用のリンク').inputValue();
	expect(link).toContain(`room=${code}`);

	const output = await context.newPage();
	await output.goto(link);
	await expect(host.getByText('配信用の出力').first()).toBeVisible({ timeout: 30_000 });

	// つながる前も後も、文字やボタンは出ない
	await expect(output.getByRole('button')).toHaveCount(0);
	await expect(output.getByText('配信用の出力')).toBeHidden();

	await host.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(output);
	// 音は最初から出す設定になっている
	await expect
		.poll(() => output.evaluate(() => [...document.querySelectorAll('video')].some((video) => !video.muted)))
		.toBe(true);
});

test('受け付けを止めると、合言葉ではつながらなくなる', async ({ context }) => {
	const host = await openHost(context);
	const code = await roomCode(host);
	await host.getByRole('button', { name: '受け付けを止める' }).click();
	await expect(host.getByText('合言葉での受け付けは止めています。')).toBeVisible();

	const page = await context.newPage();
	await page.goto('/camera/');
	await page.getByLabel(/6桁の合言葉/).fill(code);
	await page.getByRole('button', { name: 'つなぐ', exact: true }).click();
	await expect(page.getByText(/まだ開かれていません/)).toBeVisible();
	await expect(host.getByText('0台とつながっています')).toBeVisible();
});
