/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * サービスワーカー — アプリをオフラインで開けるようにする
 *
 * 初回にアプリの全ファイルを端末に保存しておき、以降はネットワークなしでも起動できる。
 * 文化祭当日はインターネットにつながらない前提なので、保存済みのファイルを最優先で使う。
 */

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `charms-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	// 古いバージョンの保存データを消す
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// 保存済みのファイルがあれば、それを返す（?role=... などの付加情報は無視して探す）
			const cached = await cache.match(request, { ignoreSearch: true });
			if (cached) return cached;

			try {
				return await fetch(request);
			} catch (error) {
				// オフラインで未保存のページを開こうとしたときは、トップページを返す
				if (request.mode === 'navigate') {
					const scope = new URL(sw.registration.scope).pathname;
					const home = await cache.match(scope);
					if (home) return home;
				}
				throw error;
			}
		})()
	);
});
