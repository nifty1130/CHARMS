<script lang="ts">
	import type { Role } from '$lib/roles';

	interface Props {
		role: Role;
		index: number;
		class?: string;
	}

	let { role, index, class: className = '' }: Props = $props();
	let indexLabel = $derived(String(index + 1).padStart(2, '0'));
</script>

<a
	href={role.href}
	class="group relative flex h-full flex-col bg-zinc-900 outline-none transition-colors duration-200 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-100 {className}"
>
	<!-- top: index / code / instance limit -->
	<div
		class="flex items-center justify-between border-b border-zinc-800 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 tabular-nums"
	>
		<span>
			{indexLabel}
			<span class="mx-1 text-zinc-700">/</span>
			{role.code}
		</span>
		<span class="text-zinc-600">{role.limit}</span>
	</div>

	<!-- center: letter, name, description -->
	<div class="flex flex-1 flex-col px-5 pt-7 pb-5">
		<div
			class="font-mono text-[88px] leading-none font-extralight text-zinc-800 transition-colors duration-300 group-hover:text-zinc-100"
			aria-hidden="true"
		>
			{role.letter}
		</div>

		<h3 class="mt-5 text-xl font-medium tracking-tight text-zinc-100">
			{role.name}
		</h3>
		<div class="mt-0.5 text-sm text-zinc-400">{role.nameJa}</div>

		<p class="mt-4 text-xs leading-relaxed text-zinc-400">
			{role.description}
		</p>
	</div>
</a>
