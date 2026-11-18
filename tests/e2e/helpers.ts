import { expect, type BrowserContext, type Page } from '@playwright/test';

/** ホストのページを開く */
export async function openHost(context: BrowserContext): Promise<Page> {
	const page = await context.newPage();
	await page.goto('/host/');
	await expect(page.getByRole('heading', { name: '端末をつなぐ' })).toBeVisible();
	return page;
}

/**
 * 役割のページを開き、同じブラウザで開いているホストにつなぐ
 *
 * @param path 役割のページ（例: '/camera/'）
 * @param name つながったあとに付く名前（例: 'カメラ 1'）
 */
export async function join(context: BrowserContext, path: string, name: string): Promise<Page> {
	const page = await context.newPage();
	await page.goto(path);
	await page.getByRole('button', { name: 'この端末のホストにつなぐ' }).click();
	if (path === '/monitor/') {
		// モニターは全画面表示なので、中央に大きく出る自分の名前で確かめる
		await expect(page.getByText(name).first()).toBeVisible();
	} else {
		await expect(page.getByRole('status').filter({ hasText: name })).toBeVisible();
	}
	return page;
}

/** カメラのページで、カメラの映像を送り始める */
export async function startCamera(page: Page): Promise<void> {
	await page.getByRole('button', { name: /この端末のカメラ/ }).click();
	await expect(page.getByText('カメラで撮影中')).toBeVisible();
}

/** モニターに、実際に絵が出ていることを確かめる */
export async function expectMonitorShowsVideo(page: Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					[...document.querySelectorAll('video')].some(
						(video) =>
							video.videoWidth > 0 && !video.paused && getComputedStyle(video).opacity === '1'
					)
				),
			{ timeout: 20_000 }
		)
		.toBe(true);
}

/**
 * モニターが描いているテロップを調べる
 *
 * @param mode full: テロップだけを映している / overlay: カメラ映像に重ねている
 * @returns 白い文字が描かれているか、左上の隅が透けているか（描いていなければ null）
 */
export async function telopPixels(
	page: Page,
	mode: 'full' | 'overlay'
): Promise<{ text: boolean; clearCorner: boolean } | null> {
	return page.evaluate((mode) => {
		const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-telop="${mode}"]`);
		const context = canvas?.getContext('2d');
		if (!canvas || !context || canvas.width === 0) return null;
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		let text = false;
		for (let i = 0; i < data.length; i += 16) {
			if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230 && data[i + 3] > 230) {
				text = true;
				break;
			}
		}
		return { text, clearCorner: data[3] === 0 };
	}, mode);
}

/** ページ内の映像（確認用の小さな映像など）が、指定した数だけ再生されていることを確かめる */
export async function expectPlayingVideos(page: Page, count: number): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						[...document.querySelectorAll('video')].filter(
							(video) => video.videoWidth > 0 && !video.paused
						).length
				),
			{ timeout: 20_000 }
		)
		.toBeGreaterThanOrEqual(count);
}
