<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Role } from '$lib/roles';

	interface Props {
		role: Role;
		/** 招待リンクから開いたときの合言葉（役割のページに引き継ぐ） */
		room?: string | null;
		class?: string;
	}

	let { role, room = null, class: className = '' }: Props = $props();
	const isHost = $derived(role.id === 'host');
	const href = $derived(resolve(role.path) + (room && !isHost ? `?room=${room}` : ''));
</script>

<a
	{href}
	class="group relative flex h-full flex-col bg-zinc-900 outline-none transition-colors duration-200 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-100 focus-visible:ring-inset {className}"
>
	<!-- 上段: 英字の略号と台数 -->
	<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
		<span class="tag">{role.code}</span>
		<span
			class="px-2 py-0.5 text-xs {isHost
				? 'border border-amber-500/70 text-amber-300'
				: 'text-zinc-400'}"
		>
			{role.limit}
		</span>
	</div>

	<!-- 中段: 頭文字・名前・説明 -->
	<div class="flex flex-1 flex-col px-5 pt-5 pb-5">
		<div class="flex items-end gap-4">
			<div
				class="font-mono text-6xl leading-none font-extralight transition-colors duration-300 group-hover:text-zinc-100 {isHost
					? 'text-amber-400/70'
					: 'text-zinc-700'}"
				aria-hidden="true"
			>
				{role.letter}
			</div>
			<div class="pb-1">
				<h2 class="text-2xl font-semibold tracking-tight text-zinc-100">{role.title}</h2>
				<div class="tag mt-0.5 normal-case">{role.name}</div>
			</div>
		</div>

		<p class="mt-4 text-base leading-relaxed text-zinc-200">{role.summary}</p>
		<p class="mt-2 text-sm leading-relaxed text-zinc-500">{role.device}</p>

		<div class="mt-auto pt-5 text-sm font-medium text-zinc-400 group-hover:text-zinc-100">
			この役割にする →
		</div>
	</div>
</a>
