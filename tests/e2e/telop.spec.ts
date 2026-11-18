import { expect, test, type Page } from '@playwright/test';
import { expectMonitorShowsVideo, join, openHost, startCamera, telopPixels } from './helpers';

/**
 * テロップのテスト: カメラ映像への重ね表示、台本（Markdown・昔の書き方）、型の調整
 */

/** 台本を入力して、送り出しへ進む */
async function useScript(admin: Page, script: string) {
	await admin.getByRole('tab', { name: '歌詞' }).click();
	const editButton = admin.getByRole('button', { name: '台本を編集する' });
	if (await editButton.isVisible()) await editButton.click();
	await admin.getByLabel(/歌詞の台本/).fill(script);
	await admin.getByRole('button', { name: '台本を決定して、送り出しへ進む' }).click();
}

test('テロップを重ねると、カメラ映像の上に背景が透けた文字が出る', async ({ context }) => {
	await openHost(context);
	const camera = await join(context, '/camera/', 'カメラ 1');
	const admin = await join(context, '/admin/', 'テロップ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');
	const controller = await join(context, '/controller/', 'スイッチャー 1');
	await startCamera(camera);

	await useScript(admin, ['# 旅立ちの日に', '型: 歌詞（下に1〜2行）', '白い光の中に', '山なみは萌えて'].join('\n'));
	await admin.getByRole('button', { name: /^最初を出す/ }).click();

	await controller.getByRole('button', { name: 'カメラ 1 を映す' }).click();
	await expectMonitorShowsVideo(monitor);
	// 「テロップを重ねる」は、重ねるものにテロップを選ぶ
	await controller.getByRole('button', { name: /^テロップを重ねる/ }).click();
	await expect
		.poll(() => telopPixels(monitor, 'overlay'), { timeout: 20_000 })
		.toEqual({ text: true, clearCorner: true });
	// カメラの映像は、そのまま下に出ている（テロップの映像は受け取らない）
	await expectMonitorShowsVideo(monitor);
	expect(await monitor.locator('video').count()).toBe(1);
	await expect(admin.getByText('● 本番中')).toBeVisible();

	// テロップで次を送ると、モニターの文字も変わる
	const before = await monitor.locator('canvas[data-telop="overlay"]').evaluate((c: HTMLCanvasElement) => c.toDataURL());
	await admin.getByRole('button', { name: /^次へ/ }).click();
	await expect
		.poll(() => monitor.locator('canvas[data-telop="overlay"]').evaluate((c: HTMLCanvasElement) => c.toDataURL()))
		.not.toBe(before);

	// 文字を消すと、重ねていた文字も消える
	await admin.getByRole('button', { name: '文字を消す' }).click();
	await expect.poll(() => telopPixels(monitor, 'overlay')).toEqual({ text: false, clearCorner: true });
});

test('台本の書き方の注意が出て、送る順の一覧に枠と区切りが出る', async ({ context }) => {
	await openHost(context);
	const admin = await join(context, '/admin/', 'テロップ 1');
	await admin.getByRole('tab', { name: '歌詞' }).click();

	// 歌詞のすぐ下の「---」は見出しになる、と知らせる
	await admin.getByLabel(/歌詞の台本/).fill('中央: 友達さ\n---');
	await expect(admin.getByRole('status', { name: '書き方の注意' })).toContainText('1行目');
	await expect(admin.getByRole('button', { name: '台本を決定して、送り出しへ進む' })).toBeDisabled();

	await admin
		.getByLabel(/歌詞の台本/)
		.fill(
			[
				'# 怪獣の花唄',
				'> 前奏なし。いきなり歌い出し',
				'',
				'左上: そうだ',
				'右下: うれしいんだ',
				'中央: 生きる**よろこび**',
				'',
				'- 左上: 愛と',
				'- 右下: 勇気だけが',
				'',
				'---',
				'',
				'# 次の曲',
				'大空'
			].join('\n')
		);
	await expect(admin.getByRole('status', { name: '書き方の注意' })).toHaveCount(0);
	await expect(admin.getByText('2曲・送り 6回')).toBeVisible();
	await admin.getByRole('button', { name: '台本を決定して、送り出しへ進む' }).click();

	// 曲を選べ、最初の送りの前のメモが出る
	await expect(admin.getByRole('button', { name: '怪獣の花唄' })).toHaveAttribute('aria-pressed', 'true');
	await expect(admin.getByLabel('次の送りのメモ')).toContainText('前奏なし');
	const list = admin.getByRole('list', { name: '送る順の一覧' });
	await expect(list.getByRole('button')).toHaveText([/左上\s*そうだ/, /右下\s*うれしいんだ/, /中央\s*生きるよろこび/, /左上\s*愛と\s*右下\s*勇気だけが/, /（消す）/]);

	// 押すたびに積み重なる
	await admin.getByRole('button', { name: /^最初を出す/ }).click();
	await admin.keyboard.press('Space');
	await expect(list.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step');
	await expect(admin.getByRole('button', { name: /^次へ/ })).toContainText('生きるよろこび');

	await admin.getByRole('button', { name: '次の曲' }).click();
	await expect(list.getByRole('button')).toHaveText([/中央\s*大空/]);
});

test('メモ帳で作った昔の書き方のファイル（Shift_JIS）を読み込める', async ({ context }) => {
	await openHost(context);
	const admin = await join(context, '/admin/', 'テロップ 1');
	await admin.getByRole('tab', { name: '歌詞' }).click();

	// 「SU そうだ」「SD うれしいんだ」「Clear」を Shift_JIS で書いたもの
	const sjis = Buffer.from([
		0x53, 0x55, 0x20, 0x82, 0xbb, 0x82, 0xa4, 0x82, 0xbe, 0x0d, 0x0a, 0x53, 0x44, 0x20, 0x82, 0xa4, 0x82, 0xea,
		0x82, 0xb5, 0x82, 0xa2, 0x82, 0xf1, 0x82, 0xbe, 0x0d, 0x0a, 0x43, 0x6c, 0x65, 0x61, 0x72, 0x0d, 0x0a
	]);
	const chooser = admin.waitForEvent('filechooser');
	await admin.getByRole('button', { name: 'ファイルを読み込む' }).click();
	await (await chooser).setFiles({ name: 'kaiju.txt', mimeType: 'text/plain', buffer: sjis });
	// 入力欄では、改行（Windows の \r\n）は \n にそろう
	await expect(admin.getByLabel(/歌詞の台本/)).toHaveValue('SU そうだ\nSD うれしいんだ\nClear\n');

	await admin.getByRole('button', { name: '台本を決定して、送り出しへ進む' }).click();
	const list = admin.getByRole('list', { name: '送る順の一覧' });
	await expect(list.getByRole('button')).toHaveText([/左上\s*そうだ/, /右下\s*うれしいんだ/, /（消す）/]);
});

test('型の枠をドラッグで動かすと保存され、出している文字にもすぐ反映される', async ({ context }) => {
	const host = await openHost(context);
	const admin = await join(context, '/admin/', 'テロップ 1');
	const monitor = await join(context, '/monitor/', 'モニター 1');

	await admin.getByLabel('演目名').fill('吹奏楽部');
	await admin.getByRole('button', { name: 'この文字を出す' }).click();
	await host.getByRole('button', { name: 'テロップ 1 を映す' }).click();
	await expect.poll(() => telopPixels(monitor, 'full'), { timeout: 20_000 }).toMatchObject({ text: true });
	const before = await monitor.locator('canvas[data-telop="full"]').evaluate((c: HTMLCanvasElement) => c.toDataURL());

	await admin.getByRole('tab', { name: '型の調整' }).click();
	await admin.getByRole('button', { name: '演目タイトル' }).click();
	const frame = admin.getByRole('button', { name: /枠「演目名」/ });
	const left = await frame.evaluate((element) => element.style.left);
	const box = (await frame.boundingBox())!;
	await admin.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await admin.mouse.down();
	await admin.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40, { steps: 5 });
	await admin.mouse.up();
	await expect.poll(() => frame.evaluate((element) => element.style.left)).not.toBe(left);

	// モニターの文字の位置も変わる
	await expect
		.poll(() => monitor.locator('canvas[data-telop="full"]').evaluate((c: HTMLCanvasElement) => c.toDataURL()))
		.not.toBe(before);

	// 開き直しても、調整した位置のまま
	const moved = await frame.evaluate((element) => element.style.left);
	admin.on('dialog', (dialog) => void dialog.accept());
	await admin.reload();
	await admin.getByRole('button', { name: 'この端末のホストにつなぐ' }).click();
	await admin.getByRole('tab', { name: '型の調整' }).click();
	await admin.getByRole('button', { name: '演目タイトル' }).click();
	await expect(admin.getByRole('button', { name: /枠「演目名」/ })).toHaveAttribute('style', new RegExp(`left: ${moved}`));

	// 最初の状態に戻せる
	await admin.getByRole('button', { name: '最初の状態に戻す' }).click();
	await expect(admin.getByRole('button', { name: /枠「演目名」/ })).toHaveAttribute('style', new RegExp(`left: ${left}`));
});
