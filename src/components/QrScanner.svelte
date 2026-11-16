<script lang="ts">
	import QrScanner from 'qr-scanner';
	import { onDestroy, onMount } from 'svelte';

	interface Props {
		/** QR を読み取ったとき（同じ QR を連続で読むたびに呼ばれる） */
		onScan: (data: string) => void;
		/** カメラが使えるようになった、または使えないと分かったとき */
		onReady?: (available: boolean) => void;
		class?: string;
	}

	let { onScan, onReady, class: className = '' }: Props = $props();
	let video: HTMLVideoElement | undefined = $state();
	let scanner: QrScanner | null = null;
	let status = $state<'starting' | 'running' | 'error'>('starting');
	let cameras = $state<QrScanner.Camera[]>([]);
	let cameraIndex = $state(0);

	onMount(async () => {
		if (!video) return;
		scanner = new QrScanner(video, (result) => onScan(result.data), {
			returnDetailedScanResult: true,
			highlightScanRegion: true,
			highlightCodeOutline: true,
			maxScansPerSecond: 8
		});
		try {
			await scanner.start();
			status = 'running';
			onReady?.(true);
			cameras = await QrScanner.listCameras(true).catch(() => []);
		} catch {
			status = 'error';
			onReady?.(false);
		}
	});

	onDestroy(() => {
		scanner?.destroy();
		scanner = null;
	});

	async function switchCamera() {
		if (!scanner || cameras.length < 2) return;
		cameraIndex = (cameraIndex + 1) % cameras.length;
		await scanner.setCamera(cameras[cameraIndex].id).catch(() => {});
	}
</script>

<div class="relative overflow-hidden bg-black {className}">
	<video bind:this={video} class="block h-full w-full object-cover" muted playsinline></video>

	{#if status === 'starting'}
		<div class="absolute inset-0 flex items-center justify-center bg-zinc-950 p-6 text-center">
			<p class="hint">カメラを準備しています…<br />「カメラの使用を許可」を選んでください。</p>
		</div>
	{:else if status === 'error'}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950 p-6 text-center"
		>
			<p class="text-base font-medium text-zinc-100">カメラを使えません</p>
			<p class="hint">
				ブラウザの設定でカメラを許可するか、下の「カメラが使えないとき」の方法でつないでください。
			</p>
		</div>
	{:else if cameras.length > 1}
		<button
			type="button"
			class="btn absolute right-2 bottom-2 min-h-9 bg-zinc-950/80 px-3 py-1 text-xs"
			onclick={switchCamera}
		>
			カメラを切り替える
		</button>
	{/if}
</div>
