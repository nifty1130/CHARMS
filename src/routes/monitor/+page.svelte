<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getSession } from '$lib/session';

	let video: HTMLVideoElement | undefined = $state();
	let ready = $state(false);
	let connected = $state(false);
	let sourceLabel: string | null = $state(null);
	let fullscreen = $state(false);

	onMount(() => {
		if (!getSession('monitor')) {
			goto('/connect?role=monitor', { replaceState: true });
			return;
		}
		ready = true;

		const onFsChange = () => {
			fullscreen = !!document.fullscreenElement;
		};
		document.addEventListener('fullscreenchange', onFsChange);
		return () => document.removeEventListener('fullscreenchange', onFsChange);
	});

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen().catch(() => {});
		} else {
			document.exitFullscreen().catch(() => {});
		}
	}

	// TODO: WebRTC 受信時に connected / sourceLabel / video.srcObject を更新
</script>

<svelte:head>
	<title>CHARMsExEx — Monitor</title>
</svelte:head>

{#if ready}
	<div class="fixed inset-0 overflow-hidden bg-black">
		<!-- 映像出力(srcObject が undefined のあいだは黒のまま) -->
		<video
			bind:this={video}
			autoplay
			playsinline
			class="absolute inset-0 h-full w-full bg-black object-contain"
		></video>

		<!-- 未割当てプレースホルダ -->
		{#if !connected}
			<div
				class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black select-none"
			>
				<div
					class="font-mono leading-none font-extralight text-zinc-800"
					style="font-size: clamp(140px, 24vw, 300px);"
				>
					M
				</div>
				<div
					class="mt-10 font-mono text-[11px] uppercase tracking-[0.5em] text-zinc-500"
				>
					no source
				</div>
				<div class="mt-3 text-xs text-zinc-600">
					Controller の割り当てを待機しています
				</div>
			</div>
		{/if}

		<!-- 上部ステータスバー -->
		<div
			class="absolute top-0 right-0 left-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em]"
		>
			<div class="flex items-center gap-2.5">
				{#if connected}
					<span class="relative flex size-1.5">
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70"
						></span>
						<span class="relative inline-flex size-1.5 rounded-full bg-emerald-400"></span>
					</span>
					<span class="text-zinc-200">MON</span>
					<span class="text-zinc-600">·</span>
					<span class="text-zinc-400">live</span>
					{#if sourceLabel}
						<span class="text-zinc-600">·</span>
						<span class="text-zinc-300">{sourceLabel}</span>
					{/if}
				{:else}
					<span class="size-1.5 rounded-full bg-zinc-700"></span>
					<span class="text-zinc-400">MON</span>
					<span class="text-zinc-600">·</span>
					<span class="text-zinc-500">no source</span>
				{/if}
			</div>

			<button
				type="button"
				onclick={toggleFullscreen}
				class="text-zinc-500 transition-colors hover:text-zinc-200"
			>
				[{fullscreen ? 'exit fullscreen' : 'fullscreen'}]
			</button>
		</div>
	</div>
{/if}
