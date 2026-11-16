import { defineConfig, devices } from '@playwright/test';

/**
 * 画面を実際に操作するテスト（E2E）の設定
 *
 * 本番と同じビルド結果を配信し、1つのブラウザの中でホストや各端末のページを同時に開いて、
 * つなぐ・映像を送る・切り替える、という一連の流れを確かめる。
 */
const PORT = 4173;

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		locale: 'ja-JP',
		permissions: ['camera', 'microphone'],
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			testIgnore: /screenshots\.spec\.ts/,
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					// 本物のカメラの代わりに、ブラウザ内蔵のテスト用映像を使う
					args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
				}
			}
		},
		{
			// 説明書に載せる画面写真を撮るためのもの（npm run screenshots）
			name: 'screenshots',
			testMatch: /screenshots\.spec\.ts/,
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
				}
			}
		}
	],
	webServer: {
		command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
