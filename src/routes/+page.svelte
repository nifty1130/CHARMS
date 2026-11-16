<script lang="ts">
	import RoleCard from '../components/RoleCard.svelte';
	import { roles } from '$lib/roles';
</script>

<svelte:head>
	<title>CHARMsExEx — Role Select</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
	<div class="mx-auto max-w-7xl px-6 py-10 md:px-10 md:py-14">
		<!-- system bar -->
		<header class="flex items-center justify-between border-b border-zinc-800 pb-4">
			<div class="flex items-center gap-3">
				<span class="relative flex size-2">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"
					></span>
					<span class="relative inline-flex size-2 rounded-full bg-red-500"></span>
				</span>
				<span class="font-mono text-xs uppercase tracking-[0.22em] text-zinc-200">
					CHARMsExEx
				</span>
			</div>
			<div
				class="hidden items-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 sm:flex"
			>
				<span>LAN ONLY</span>
				<span class="text-zinc-700">·</span>
				<span>WebRTC P2P</span>
				<span class="text-zinc-700">·</span>
				<span class="tabular-nums">v0.1</span>
			</div>
		</header>

		<!-- title -->
		<section class="py-8 md:py-10">
			<h1 class="text-2xl font-medium tracking-tight text-zinc-100">役割選択</h1>
		</section>

		<!-- role grid -->
		<section
			aria-label="役割の選択"
			class="grid grid-cols-1 gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-2 lg:grid-cols-5"
		>
			{#each roles as role, i (role.id)}
				<RoleCard
					{role}
					index={i}
					class={role.id === 'host' ? 'md:col-span-2 lg:col-span-1' : ''}
				/>
			{/each}
		</section>
	</div>
</div>
