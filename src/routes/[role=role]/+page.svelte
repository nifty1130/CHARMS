<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getSession } from '$lib/session';
	import { roles, type RoleId } from '$lib/roles';

	let role = $derived(page.params.role as RoleId);
	let info = $derived(roles.find((r) => r.id === role));
	let ready = $state(false);

	onMount(() => {
		const session = getSession(role);
		if (!session) {
			goto(`/connect?role=${role}`, { replaceState: true });
			return;
		}
		ready = true;
	});
</script>

<svelte:head>
	<title>CHARMsExEx — {info?.name ?? ''}</title>
</svelte:head>

{#if ready && info}
	<div class="min-h-screen bg-zinc-950 text-zinc-100">
		<div class="mx-auto max-w-7xl px-6 py-10 md:px-10 md:py-14">
			<header class="flex items-center justify-between border-b border-zinc-800 pb-4">
				<div class="flex items-center gap-3">
					<span class="size-2 rounded-full bg-emerald-400"></span>
					<span class="font-mono text-xs uppercase tracking-[0.22em] text-zinc-200">
						CHARMsExEx
						<span class="mx-1 text-zinc-700">·</span>
						{info.code}
					</span>
				</div>
			</header>

			<section class="py-8 md:py-10">
				<div class="font-mono text-xs uppercase tracking-[0.22em] text-zinc-500">
					{info.code}
				</div>
				<h1 class="mt-2 text-2xl font-medium tracking-tight">{info.name}</h1>
				<p class="mt-1 text-sm text-zinc-400">{info.nameJa}</p>
			</section>

			<div
				class="border border-zinc-800 bg-zinc-900 p-8 font-mono text-xs text-zinc-500"
			>
				// {info.code} の画面はここに実装されます
			</div>
		</div>
	</div>
{/if}
