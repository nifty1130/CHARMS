<script lang="ts">
	import { gradeLink, type LinkStats } from '$lib/charms/stats';

	/**
	 * 映像接続ごとの通信の状態を、表で見せる
	 *
	 * 「カクカクする」ときに、どの相手との間で、何が起きているかの見当を付けるためのもの。
	 */
	interface Props {
		links: LinkStats[];
		/** 相手の端末の名前を引く */
		nameOf: (peerId: string) => string;
	}

	let { links, nameOf }: Props = $props();

	const GRADE = {
		good: { label: '良好', class: 'bg-emerald-400' },
		fair: { label: 'やや不安定', class: 'bg-amber-400' },
		poor: { label: '不安定', class: 'bg-red-500' }
	} as const;

	function rate(kbps: number | null): string {
		if (kbps === null) return '—';
		return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
	}

	function note(link: LinkStats): string {
		const notes: string[] = [];
		if (link.path === 'relay') notes.push('中継サーバー経由');
		// 確認用の小さな映像は、意図して画質を絞っているので、本番用の映像についてだけ知らせる
		if (link.profile === 'program') {
			if (link.limitation === 'cpu') notes.push('端末の処理が追いつかず、画質を下げています');
			if (link.limitation === 'bandwidth') notes.push('回線が細く、画質を下げています');
		}
		if ((link.lossPercent ?? 0) >= 5) notes.push('データが多く欠けています');
		return notes.join('。');
	}
</script>

{#if links.length === 0}
	<p class="hint p-4">映像を送り合っている相手がいないため、まだ調べられません。</p>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full min-w-[30rem] text-left text-sm">
			<thead class="text-xs text-zinc-400">
				<tr class="border-b border-zinc-800">
					<th class="px-3 py-2 font-medium">相手</th>
					<th class="px-3 py-2 font-medium">状態</th>
					<th class="px-3 py-2 font-medium">経路</th>
					<th class="px-3 py-2 text-right font-medium">通信量</th>
					<th class="px-3 py-2 text-right font-medium">コマ数</th>
					<th class="px-3 py-2 text-right font-medium">遅延</th>
					<th class="px-3 py-2 text-right font-medium">欠け</th>
				</tr>
			</thead>
			<tbody>
				{#each links as link (link.direction + link.peerId)}
					{@const grade = GRADE[gradeLink(link)]}
					{@const remark = note(link)}
					<tr class="border-b border-zinc-800/60 align-top">
						<td class="px-3 py-2 text-zinc-100">
							{link.direction === 'out' ? '→' : '←'}
							{nameOf(link.peerId)}
							{#if remark}
								<div class="mt-0.5 text-xs text-amber-200">{remark}</div>
							{/if}
						</td>
						<td class="px-3 py-2 whitespace-nowrap">
							<span class="mr-1.5 inline-block size-2 rounded-full {grade.class}"></span>{grade.label}
						</td>
						<td class="px-3 py-2 whitespace-nowrap">
							{link.path === 'relay' ? '中継' : link.path === 'direct' ? '直接' : '—'}
						</td>
						<td class="px-3 py-2 text-right font-mono whitespace-nowrap">{rate(link.kbps)}</td>
						<td class="px-3 py-2 text-right font-mono whitespace-nowrap">
							{link.fps === null ? '—' : `${link.fps} コマ/秒`}
						</td>
						<td class="px-3 py-2 text-right font-mono whitespace-nowrap">
							{link.rttMs === null ? '—' : `${link.rttMs} ms`}
						</td>
						<td class="px-3 py-2 text-right font-mono whitespace-nowrap">
							{link.lossPercent === null ? '—' : `${link.lossPercent}%`}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="hint px-3 py-2 text-xs">
		「中継」は、端末同士が直接つながらず、インターネット上の中継サーバーを通っている状態です。全端末を同じ
		LAN につなぐと「直接」になり、安定します。
	</p>
{/if}
