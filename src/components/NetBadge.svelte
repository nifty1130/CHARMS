<script lang="ts">
	import type { NetInfo } from '$lib/charms/protocol';

	/**
	 * 端末の通信の状態を、短い言葉で見せる（端末の一覧やスイッチャーの画面用）
	 *
	 * 良好で、直接つながっているときは何も出さない（画面をうるさくしない）。
	 */
	interface Props {
		net: NetInfo | undefined;
	}

	let { net }: Props = $props();
</script>

{#if net}
	{#if net.quality === 'poor'}
		<span class="font-medium text-red-400">通信が不安定</span>
	{:else if net.quality === 'fair'}
		<span class="font-medium text-amber-300">通信がやや不安定</span>
	{/if}
	{#if net.relay}
		<span class="border border-sky-500/60 px-1 text-sky-300">中継</span>
	{/if}
{/if}
