import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// GitHub Pages では https://<user>.github.io/CHARMsExEx/ のようにサブフォルダで配信されるため、
// ビルド時に BASE_PATH=/CHARMsExEx を渡す。手元では空（ルート）のまま。
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig(({ mode }) => ({
	plugins: [
		// カメラは https か localhost でしか使えない。
		// スマホなど別の端末から開発サーバーを開くとき（npm run dev:lan）だけ、自己署名の https にする。
		...(mode === 'lan' ? [basicSsl()] : []),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},

			// サーバーを持たないアプリなので、静的ファイルとして書き出す。
			// 404.html は、存在しない URL を開いたときにアプリ本体へ戻すためのもの。
			adapter: adapter({ fallback: '404.html' }),
			paths: { base }
		})
	],
	// テスト実行中の再読み込み（不安定さの原因）を避けるため、依存を事前に最適化しておく
	optimizeDeps: { include: ['ipaddr.js', 'qrcode', 'qr-scanner'] },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright({
							launchOptions: {
								// 本物のカメラの代わりに、ブラウザ内蔵のテスト用映像を使う
								args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
							}
						}),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
}));
