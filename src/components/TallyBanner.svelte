<script lang="ts">
	import type { NodeInfo } from '$lib/charms/protocol';

	/**
	 * タリー表示 — 自分の映像がいま使われているかを知らせる帯
	 *
	 * 放送用カメラの「赤ランプ」にあたる。赤なら本番に出ていて、緑なら次に出る予定。
	 */
	interface Props {
		/** 本番・予告に出ているモニターの ID */
		tally: { program: string[]; preview: string[] };
		nodes: NodeInfo[];
	}

	let { tally, nodes }: Props = $props();

	function names(ids: string[]): string {
		return ids.map((id) => nodes.find((node) => node.id === id)?.name ?? id).join('、');
	}
</script>

{#if tally.program.length > 0}
	<div class="flex flex-wrap items-center gap-x-3 bg-red-600 px-4 py-2.5 text-white" role="status">
		<span class="text-lg font-bold tracking-wide">● 本番中</span>
		<span class="text-sm">{names(tally.program)} に映っています</span>
	</div>
{:else if tally.preview.length > 0}
	<div class="flex flex-wrap items-center gap-x-3 bg-emerald-600 px-4 py-2.5 text-white" role="status">
		<span class="text-lg font-bold tracking-wide">予告</span>
		<span class="text-sm">まもなく {names(tally.preview)} に映ります</span>
	</div>
{:else}
	<div class="flex flex-wrap items-center gap-x-3 bg-zinc-800 px-4 py-2.5 text-zinc-300" role="status">
		<span class="text-lg font-bold tracking-wide">待機中</span>
		<span class="text-sm">いまはどのモニターにも映っていません</span>
	</div>
{/if}
