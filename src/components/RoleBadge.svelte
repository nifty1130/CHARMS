<script lang="ts">
	import type { Role } from '$lib/roles';

	interface Props {
		role: Role;
	}

	let { role }: Props = $props();
	let isHost = $derived(role.id === 'host');
</script>

<div
	class={`flex items-center gap-5 border px-5 py-4 ${
		isHost ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900'
	}`}
>
	<div
		class={`font-mono text-4xl leading-none font-extralight ${
			isHost ? 'text-amber-300' : 'text-zinc-300'
		}`}
		aria-hidden="true"
	>
		{role.letter}
	</div>

	<div class="flex-1">
		<div class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
			role
			<span class="mx-1 text-zinc-700">/</span>
			{role.code}
		</div>
		<div class="mt-0.5 text-base font-medium tracking-tight text-zinc-100">
			{role.name}
			<span class="text-sm font-normal text-zinc-400">/ {role.nameJa}</span>
		</div>
	</div>

	{#if isHost}
		<div
			class="border border-amber-500 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300"
		>
			HUB · single
		</div>
	{/if}
</div>
