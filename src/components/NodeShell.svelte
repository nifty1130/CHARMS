<script lang="ts">
	import type { ClientSession } from '$lib/charms/client.svelte';
	import { LocalHostFinder } from '$lib/charms/local-pairing.svelte';
	import { confirmBeforeLeaving, keepScreenAwake } from '$lib/charms/wake-lock';
	import type { Role } from '$lib/roles';
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import AppHeader from './AppHeader.svelte';
	import ConnectPanel from './ConnectPanel.svelte';

	/**
	 * ホストにつなぐ端末（カメラ・テロップ・モニター・スイッチャー）に共通の外枠
	 *
	 * つながる前は接続の手順を、つながったあとは各役割の画面（children）を出す。
	 */
	interface Props {
		session: ClientSession;
		role: Role;
		/** つながったあとに出す、役割ごとの画面 */
		children: Snippet;
		/** 画面いっぱいに表示する（モニター用。余白と見出しを付けない） */
		bare?: boolean;
		/**
		 * ホストとの接続が切れても、役割の画面を出し続ける（モニター用）
		 *
		 * 映像は端末同士が直接送り合っているので、ホストが落ちても映像は届き続ける。
		 * つなぎ直す操作をするまでは、映像を出したままにしておく。
		 */
		hold?: boolean;
	}

	let { session, role, children, bare = false, hold = false }: Props = $props();

	const finder = new LocalHostFinder();
	const showChildren = $derived(session.connected || hold);

	onMount(() => {
		const releaseWake = keepScreenAwake();
		const releaseGuard = confirmBeforeLeaving(() => session.connected);
		return () => {
			releaseWake();
			releaseGuard();
		};
	});

	onDestroy(() => {
		finder.close();
		session.destroy();
	});
</script>

{#if showChildren && bare}
	{@render children()}
{:else}
	<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-10 md:py-8">
		<AppHeader
			{role}
			status={session.connected ? 'connected' : session.lost ? 'lost' : 'waiting'}
			statusText={session.name}
		/>

		{#if showChildren}
			<div class="mt-6">
				{@render children()}
			</div>
		{:else}
			<div class="mt-6">
				{#if session.lost}
					<p class="mb-4 border border-red-500/50 bg-red-500/10 px-4 py-3 text-base text-red-100" role="alert">
						<strong class="font-semibold">ホストとの接続が切れました。</strong
						>もう一度、ホストと QR コードを読み取り合ってください。
					</p>
				{/if}
				<h1 class="text-xl font-semibold tracking-tight">ホストとつなぐ</h1>
				<p class="hint mt-1 mb-3">
					ホストの画面で「端末を追加する」を開き、お互いの QR コードを読み取り合います。
				</p>
				<ConnectPanel
					pairing={session.pairing}
					side="node"
					{finder}
					onRestart={() => session.restartPairing()}
				/>
			</div>
		{/if}
	</div>
{/if}
