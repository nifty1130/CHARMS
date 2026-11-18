<script lang="ts">
	import type { ClientSession } from '$lib/charms/client.svelte';
	import { LocalHostFinder } from '$lib/charms/local-pairing.svelte';
	import { cleanName } from '$lib/charms/protocol';
	import { confirmBeforeLeaving, keepScreenAwake } from '$lib/charms/wake-lock';
	import type { Role } from '$lib/roles';
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import AppHeader from './AppHeader.svelte';
	import ConnectPanel from './ConnectPanel.svelte';
	import RoomJoin from './RoomJoin.svelte';

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

	/** 接続が切れて、合言葉で自動的につなぎ直している最中か */
	const rejoining = $derived(
		session.lost && !session.connected && !!session.room && !session.ended
	);
	/** 自動のつなぎ直しを待たずに、接続の画面を開いたか */
	let manual = $state(false);

	// 自動でつなぎ直している間は、役割の画面をそのまま出しておく
	// （カメラの撮影や録画を止めずに済む）
	const showChildren = $derived(session.connected || hold || (rejoining && !manual));

	$effect(() => {
		if (session.connected) manual = false;
	});

	/** インカム: スイッチャーから届いている声 */
	const talkback = $derived(
		Object.entries(session.streams).filter(
			([id]) => session.snapshot.nodes.find((node) => node.id === id)?.role === 'controller'
		)
	);

	/** 届いた声を鳴らす */
	function playVoice(element: HTMLAudioElement, stream: MediaStream) {
		const attach = (next: MediaStream) => {
			element.srcObject = next;
			void element.play().catch(() => {});
		};
		attach(stream);
		return {
			update: attach,
			destroy: () => {
				element.srcObject = null;
			}
		};
	}

	// 指示が届いたら、端末を震わせて知らせ、しばらくしたら自動で消す
	$effect(() => {
		const cue = session.cue;
		if (!cue) return;
		try {
			navigator.vibrate?.(200);
		} catch {
			// 震える機能のない端末
		}
		const timer = setTimeout(() => {
			if (session.cue === cue) session.dismissCue();
		}, 20_000);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		// 招待リンクから開いたとき、または読み込み直したときは、自動でつなぐ
		const params = new URLSearchParams(location.search);
		const name = params.get('name');
		// リンクで名前が指定されていれば、それを使う（配信ソフト用の出力リンクなど）
		if (name) session.name = cleanName(name, session.name);
		session.autoJoin(params.get('room'));

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

{#each talkback as [id, stream] (id)}
	<audio use:playVoice={stream} autoplay></audio>
{/each}

{#if session.cue}
	<div
		class="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-4 bg-sky-600 px-5 py-4 text-white shadow-lg"
		role="alert"
	>
		<div class="min-w-0 flex-1">
			<div class="text-sm opacity-90">{session.cue.from} からの指示</div>
			<div class="text-3xl leading-tight font-bold break-words sm:text-4xl">{session.cue.text}</div>
		</div>
		<button
			type="button"
			class="btn border-white/70 bg-white text-sky-900 hover:bg-sky-50"
			onclick={() => session.dismissCue()}
		>
			了解
		</button>
	</div>
{/if}

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
			{#if rejoining}
				<div
					class="mt-4 flex flex-wrap items-center gap-3 border border-amber-500/50 bg-amber-500/10 px-4 py-3"
					role="alert"
				>
					<span class="size-2.5 shrink-0 animate-pulse rounded-full bg-amber-400"></span>
					<p class="min-w-0 flex-1 text-base text-amber-100">
						<strong class="font-semibold">ホストとの接続が切れました。</strong
						>自動でつなぎ直しています…
					</p>
					<button type="button" class="btn" onclick={() => (manual = true)}>
						QR コードでつなぎ直す
					</button>
				</div>
			{/if}
			<div class="mt-6">
				{@render children()}
			</div>
		{:else}
			<div class="mt-6 space-y-4">
				{#if session.ended === 'replaced'}
					<p class="border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-base text-amber-100" role="alert">
						<strong class="font-semibold">この端末は、別の画面でつなぎ直されました。</strong
						>この画面を使う場合は、もう一度つないでください。
					</p>
				{:else if session.ended === 'removed'}
					<p class="border border-red-500/50 bg-red-500/10 px-4 py-3 text-base text-red-100" role="alert">
						<strong class="font-semibold">ホストから切断されました。</strong
						>もう一度つなぐには、合言葉を入力するか、ホストと QR コードを読み取り合ってください。
					</p>
				{:else if session.lost}
					<p class="border border-red-500/50 bg-red-500/10 px-4 py-3 text-base text-red-100" role="alert">
						<strong class="font-semibold">ホストとの接続が切れました。</strong>
						{#if session.room}
							自動でつなぎ直しています。うまくいかないときは、ホストと QR コードを読み取り合ってください。
						{:else}
							もう一度、合言葉を入力するか、ホストと QR コードを読み取り合ってください。
						{/if}
					</p>
				{/if}

				<div>
					<h1 class="text-xl font-semibold tracking-tight">ホストとつなぐ</h1>
					<p class="hint mt-1">
						ホストと、お互いの QR コードを読み取り合います。ホストの画面に6桁の合言葉が出ていれば、入力するだけでもつながります。
					</p>
				</div>

				<div>
					<h2 class="mb-1 text-base font-semibold">
						QR コードでつなぐ<span class="hint ml-2 font-normal">インターネットは不要</span>
					</h2>
					<p class="hint mb-3">
						ホストの画面の「QR コードでつなぐ」を見ながら、お互いの QR コードを、この画面で読み取り合います。
					</p>
					<ConnectPanel
						pairing={session.pairing}
						side="node"
						{finder}
						onRestart={() => session.restartPairing()}
					/>
				</div>

				<RoomJoin {session} />
			</div>
		{/if}
	</div>
{/if}
