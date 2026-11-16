<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Role } from '$lib/roles';
	import type { Snippet } from 'svelte';

	interface Props {
		/** この画面の役割（トップページでは省略） */
		role?: Role;
		/** つながり具合（省略すると表示しない） */
		status?: 'connected' | 'waiting' | 'lost';
		/** 状態の横に出す文（「カメラ 1」など） */
		statusText?: string;
		/** 右端に追加で置くもの */
		children?: Snippet;
	}

	let { role, status, statusText, children }: Props = $props();

	const statusLabel = $derived(
		status === 'connected'
			? (statusText ?? 'つながっています')
			: status === 'lost'
				? '接続が切れました'
				: 'まだつながっていません'
	);
</script>

<header class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-zinc-800 pb-4">
	<div class="flex items-center gap-3">
		<a
			href={resolve('/')}
			class="flex items-center gap-2.5 text-zinc-200 hover:text-white"
			aria-label="役割の選択に戻る"
		>
			<span class="size-2.5 rounded-full bg-red-500"></span>
			<span class="font-mono text-sm tracking-[0.15em]">CHARM Point</span>
		</a>
		{#if role}
			<span class="text-zinc-700" aria-hidden="true">/</span>
			<span class="text-base font-semibold text-zinc-100">{role.title}</span>
			<span class="tag hidden sm:inline">{role.name}</span>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		{#if status}
			<div class="flex items-center gap-2 text-sm" role="status">
				<span
					class="size-2.5 rounded-full {status === 'connected'
						? 'bg-emerald-400'
						: status === 'lost'
							? 'bg-red-500'
							: 'bg-zinc-600'}"
				></span>
				<span class={status === 'lost' ? 'text-red-300' : 'text-zinc-300'}>{statusLabel}</span>
			</div>
		{/if}
		{@render children?.()}
		{#if role}
			<a href={resolve('/')} class="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline">
				役割を選び直す
			</a>
		{/if}
	</div>
</header>
