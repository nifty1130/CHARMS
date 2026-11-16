// static/icons/icon.svg から、PWA 用の PNG アイコンを作る
// 使い方: node scripts/gen-icons.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const svg = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

const targets = [
	{ file: 'icon-192.png', size: 192 },
	{ file: 'icon-512.png', size: 512 },
	// maskable（丸や角丸に切り抜かれるアイコン）用。絵柄は中央 80% に収まっているので同じ絵を使う
	{ file: 'icon-maskable-512.png', size: 512 }
];

const browser = await chromium.launch();
for (const { file, size } of targets) {
	const page = await browser.newPage({ viewport: { width: size, height: size } });
	await page.setContent(
		`<style>html,body{margin:0;background:#09090b}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
	);
	await page.screenshot({ path: join(iconsDir, file) });
	await page.close();
	console.log(`static/icons/${file}`);
}
await browser.close();
