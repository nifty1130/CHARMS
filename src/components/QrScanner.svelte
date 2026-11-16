<script lang="ts">
	import QrScanner from 'qr-scanner';
	import { onDestroy, onMount } from 'svelte';

	interface Props {
		onScan: (data: string) => void;
		class?: string;
	}

	let { onScan, class: className = '' }: Props = $props();
	let video: HTMLVideoElement | undefined = $state();
	let scanner: QrScanner | null = null;
	let error: string | null = $state(null);

	onMount(async () => {
		if (!video) return;
		scanner = new QrScanner(
			video,
			(result) => onScan(result.data),
			{
				returnDetailedScanResult: true,
				highlightScanRegion: true,
				highlightCodeOutline: true
			}
		);
		try {
			await scanner.start();
		} catch (e) {
			error = e instanceof Error ? e.message : 'カメラの起動に失敗しました';
		}
	});

	onDestroy(() => {
		scanner?.destroy();
		scanner = null;
	});
</script>

<div class="relative {className}">
	<video bind:this={video} class="block h-full w-full bg-zinc-900 object-cover"></video>

	{#if error}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/95 p-6 text-center"
		>
			<div class="font-mono text-[10px] uppercase tracking-[0.2em] text-red-400">
				camera error
			</div>
			<p class="mt-2 text-sm text-zinc-100">{error}</p>
			<p class="mt-3 text-[11px] text-zinc-400">
				ブラウザのカメラ権限と HTTPS / localhost 接続を確認してください。
			</p>
		</div>
	{/if}
</div>
