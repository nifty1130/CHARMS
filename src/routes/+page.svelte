<script lang="ts">
	import AppHeader from '../components/AppHeader.svelte';
	import RoleCard from '../components/RoleCard.svelte';
	import { formatRoomCode, normalizeRoomCode } from '$lib/charms/room';
	import { roles } from '$lib/roles';
	import { onMount } from 'svelte';

	/** ブラウザが出す「インストールできます」の合図（対応ブラウザのみ） */
	interface InstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	let installPrompt = $state<InstallPromptEvent | null>(null);
	let offlineReady = $state(false);
	/** 招待リンクから開いたときの合言葉 */
	let room = $state<string | null>(null);

	onMount(() => {
		room = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
	});

	$effect(() => {
		const onPrompt = (event: Event) => {
			event.preventDefault();
			installPrompt = event as InstallPromptEvent;
		};
		const onInstalled = () => (installPrompt = null);
		window.addEventListener('beforeinstallprompt', onPrompt);
		window.addEventListener('appinstalled', onInstalled);

		// アプリ一式が端末に保存されると、インターネットなしでも開けるようになる
		void navigator.serviceWorker?.ready.then(() => (offlineReady = true)).catch(() => {});

		return () => {
			window.removeEventListener('beforeinstallprompt', onPrompt);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function install() {
		if (!installPrompt) return;
		await installPrompt.prompt();
		await installPrompt.userChoice;
		installPrompt = null;
	}
</script>

<svelte:head>
	<title>CHARM Point</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-10 md:py-10">
	<AppHeader>
		<span class="tag hidden sm:inline">ブラウザだけで動く映像スイッチャー</span>
	</AppHeader>

	<section class="py-8 md:py-10">
		<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">この端末の役割を選んでください</h1>
		{#if room}
			<p
				class="mt-4 max-w-3xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-base leading-relaxed text-emerald-100"
				role="status"
			>
				<strong class="font-semibold">招待リンクから開きました（合言葉 {formatRoomCode(room)}）。</strong
				>ホスト以外の役割を選ぶと、自動でホストにつながります。
			</p>
		{:else}
			<p class="mt-3 max-w-3xl text-base leading-relaxed text-zinc-300">
				まず1台を<strong class="font-semibold text-amber-300">ホスト</strong
				>にします。ほかの端末は役割を選び、ホストの画面に出る合言葉を入力するか、QR
				コードを見せ合うとつながります。QR コードなら、インターネットのない場所でも使えます。
			</p>
		{/if}
	</section>

	<section
		aria-label="役割の選択"
		class="grid grid-cols-1 gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-2 lg:grid-cols-5"
	>
		{#each roles as role (role.id)}
			<RoleCard {role} {room} class={role.id === 'host' ? 'sm:col-span-2 lg:col-span-1' : ''} />
		{/each}
	</section>

	<section class="mt-10 grid grid-cols-1 gap-px border border-zinc-800 bg-zinc-800 md:grid-cols-3">
		{#each [{ step: '1', title: 'ホストを1台開く', text: 'カメラ付きの PC で「ホスト」を選びます。本番が終わるまで、この画面は閉じません。' }, { step: '2', title: 'ほかの端末をつなぐ', text: 'それぞれの端末で役割を選び、ホストの画面に出ている合言葉を入力します。インターネットのない場所では、QR コードを読み取り合います。' }, { step: '3', title: '映像を切り替える', text: '「スイッチャー」かホストの画面で、どのカメラをどのモニターに映すかを選びます。' }] as item (item.step)}
			<div class="bg-zinc-900 p-5">
				<div class="flex items-baseline gap-3">
					<span class="font-mono text-3xl leading-none font-light text-zinc-600">{item.step}</span>
					<h2 class="text-lg font-semibold">{item.title}</h2>
				</div>
				<p class="hint mt-3">{item.text}</p>
			</div>
		{/each}
	</section>

	<section class="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border border-zinc-800 bg-zinc-900 px-5 py-4">
		<div class="min-w-0 flex-1">
			<h2 class="text-base font-semibold">当日、インターネットなしで使うには</h2>
			<p class="hint mt-1">
				{#if offlineReady}
					この端末には保存済みです。次からはインターネットにつながっていなくても開けます。
				{:else}
					インターネットにつながる場所で、使う端末すべてでこのページを一度開いておいてください。
				{/if}
			</p>
		</div>
		{#if installPrompt}
			<button type="button" class="btn btn-primary" onclick={install}>この端末にインストール</button>
		{:else if offlineReady}
			<span class="flex items-center gap-2 text-sm text-emerald-300">
				<span class="size-2.5 rounded-full bg-emerald-400"></span>オフラインで使えます
			</span>
		{/if}
	</section>
</div>
