<script lang="ts">
	import LinkStatsTable from '../../components/LinkStatsTable.svelte';
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import VideoView from '../../components/VideoView.svelte';
	import { ClientSession } from '$lib/charms/client.svelte';
	import type { Layout } from '$lib/charms/protocol';
	import { ProgramMixer } from '$lib/charms/recorder';
	import { secondaryOf } from '$lib/charms/routing';
	import { roleOf } from '$lib/roles';
	import { onMount, untrack } from 'svelte';

	const session = new ClientSession('monitor');
	const role = roleOf('monitor');

	/** ホストから指示された、このモニターの映し方 */
	const route = $derived(session.snapshot.routes.find((r) => r.monitorId === session.id));
	/** 「いま映すべき映像」 */
	const programId = $derived(route?.program ?? null);
	const sourceIds = $derived(Object.keys(session.streams));

	/** 実際に画面に出している映像 */
	let shownId = $state<string | null>(null);
	/** 絵が出始めた映像（ストリームごとに覚える） */
	const playing = new WeakSet<MediaStream>();
	/** playing が変わったことを画面に伝えるためのカウンター */
	let playingVersion = $state(0);

	/** 重ねて（並べて）出している、もう1つの映像。絵が出始めてから出す */
	const subId = $derived.by(() => {
		void playingVersion;
		const wanted = secondaryOf(route);
		if (!wanted || wanted === shownId) return null;
		const stream = session.streams[wanted];
		return stream && playing.has(stream) ? wanted : null;
	});
	/** 実際の画面の作り方（重ねる映像がまだ出せないときは、1画面にしておく） */
	const view = $derived<Layout>(subId ? (route?.layout ?? 'single') : 'single');

	let videos = $state<Record<string, HTMLVideoElement>>({});
	let soundOn = $state(false);
	/**
	 * 映像だけを出す（配信ソフトに取り込むとき用。リンクに `?clean=1` を付ける）
	 *
	 * 操作パネルや名前を出さず、つながる前も黒い画面のまま待つ。
	 */
	let clean = $state(false);
	let fullscreen = $state(false);
	let controlsVisible = $state(true);
	let menuOpen = $state(false);
	/** つなぎ直しの画面を開いているか */
	let reconnecting = $state(false);
	let mixer: ProgramMixer | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	// 画面に出す映像を決める。
	// 次の映像の絵が出るまでは前の映像を出し続けるので、切り替えで黒い画面が挟まらない。
	$effect(() => {
		void playingVersion;
		const streams = session.streams;
		const current = untrack(() => shownId);

		if (programId === null) {
			shownId = null;
		} else if (streams[programId] && playing.has(streams[programId])) {
			shownId = programId;
		} else if (current && !streams[current]) {
			shownId = null;
		}
	});

	// 録画中は、画面に出している映像を録画にも反映する
	$effect(() => {
		const id = shownId;
		mixer?.setProgram(id ? (videos[id] ?? null) : null, id ? (session.streams[id] ?? null) : null);
		mixer?.setSecondary(subId ? (videos[subId] ?? null) : null, view);
	});

	/** 映像ごとの、画面の中での置き方 */
	function placement(id: string): { class: string; fit: 'contain' | 'cover' } {
		if (id === shownId) {
			return {
				class: view === 'split' ? 'inset-y-0 left-0 h-full w-1/2 opacity-100' : 'inset-0 h-full w-full opacity-100',
				fit: 'contain'
			};
		}
		if (id === subId) {
			if (view === 'pip') {
				// ワイプ: 右下に小さく、白い枠を付けて出す
				return {
					class: 'right-[3%] bottom-[3%] z-[1] aspect-video w-[28%] border-2 border-white/80 opacity-100 shadow-lg',
					fit: 'cover'
				};
			}
			if (view === 'split') return { class: 'inset-y-0 right-0 h-full w-1/2 opacity-100', fit: 'contain' };
			// テロップ重ね: 黒い部分を透かして、明るい文字だけを重ねる
			return { class: 'inset-0 z-[1] h-full w-full opacity-100 mix-blend-screen', fit: 'contain' };
		}
		return { class: 'inset-0 h-full w-full opacity-0', fit: 'contain' };
	}

	// 音を出しているかどうかを、ホストとスイッチャーに知らせる
	$effect(() => {
		const sound = soundOn;
		if (session.connected) session.setStatus({ sound });
	});

	// スイッチャーからの遠隔操作を受ける
	session.onMonitorCommand = (command) => {
		if (command.action === 'sound') soundOn = command.on;
	};

	// つながり直したら、つなぎ直しの画面を閉じる
	$effect(() => {
		if (session.connected) reconnecting = false;
	});

	onMount(() => {
		const params = new URLSearchParams(location.search);
		clean = params.get('clean') === '1';
		if (params.get('sound') === '1') soundOn = true;

		const onFullscreen = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFullscreen);
		wake();
		return () => {
			document.removeEventListener('fullscreenchange', onFullscreen);
			clearTimeout(hideTimer);
			mixer?.destroy();
		};
	});

	function markPlaying(id: string) {
		const stream = session.streams[id];
		if (!stream || playing.has(stream)) return;
		playing.add(stream);
		playingVersion++;
	}

	/** 操作があったら操作パネルを出し、しばらくすると隠す */
	function wake() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!menuOpen) controlsVisible = false;
		}, 4000);
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		else void document.documentElement.requestFullscreen().catch(() => {});
	}

	function nameOf(id: string | null): string {
		return session.snapshot.nodes.find((node) => node.id === id)?.name ?? '';
	}

	function startMix(): MediaStream {
		mixer?.destroy();
		mixer = new ProgramMixer();
		const id = shownId;
		mixer.setProgram(id ? (videos[id] ?? null) : null, id ? (session.streams[id] ?? null) : null);
		mixer.setSecondary(subId ? (videos[subId] ?? null) : null, view);
		return mixer.stream;
	}

	function stopMix() {
		mixer?.destroy();
		mixer = null;
	}
</script>

<svelte:head>
	<title>モニター — CHARM Point</title>
</svelte:head>

<NodeShell {session} {role} bare hold={clean || (session.lost && !reconnecting)}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 overflow-hidden bg-black {controlsVisible ? '' : 'cursor-none'}"
		onpointermove={wake}
		onpointerdown={wake}
	>
		<!-- 受け取っている映像を重ねて置き、いま映すものだけを見せる。
		     予告の映像も裏で再生しておくので、切り替えが一瞬で済む -->
		{#each sourceIds as id (id)}
			{@const place = placement(id)}
			<VideoView
				stream={session.streams[id]}
				muted={!(soundOn && id === shownId)}
				bind:element={videos[id]}
				onPlaying={() => markPlaying(id)}
				fit={place.fit}
				class="absolute {place.class}"
			/>
		{/each}

		<!-- 何も映していないとき -->
		{#if shownId === null && !clean}
			<div
				class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-8 text-center select-none"
			>
				<div class="text-4xl font-semibold tracking-tight text-zinc-300 sm:text-6xl">
					{session.name}
				</div>
				<div class="mt-6 text-lg text-zinc-500">
					{programId ? '映像を受け取っています…' : '映像を待っています'}
				</div>
				{#if !programId}
					<div class="mt-2 text-sm text-zinc-600">
						スイッチャーかホストで、このモニターに映す映像を選んでください
					</div>
				{/if}
			</div>
		{/if}

		<!-- ホストとの接続が切れたとき（映像は出し続ける） -->
		{#if !session.connected && !clean}
			<div class="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-red-950/90 px-4 py-3 text-center">
				<span class="text-base text-red-100">
					{#if session.ended === 'removed'}
						ホストから切断されました。
					{:else if session.ended === 'replaced'}
						この端末は、別の画面でつなぎ直されました。
					{:else}
						ホストとの接続が切れました。{session.room
							? '自動でつなぎ直しています…'
							: shownId
								? 'いまの映像は出し続けますが、切り替えはできません。'
								: ''}
					{/if}
				</span>
				<button type="button" class="btn" onclick={() => (reconnecting = true)}>
					{session.room ? 'QR コードでつなぎ直す' : 'ホストとつなぎ直す'}
				</button>
			</div>
		{/if}

		<!-- 操作パネル（画面に触れると出る） -->
		<div
			hidden={clean}
			class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-4 transition-opacity duration-300 {controlsVisible
				? 'opacity-100'
				: 'pointer-events-none opacity-0'}"
		>
			<div class="flex flex-wrap items-center gap-3">
				<div class="mr-auto min-w-0">
					<div class="truncate text-base font-semibold text-zinc-100">{session.name}</div>
					<div class="text-sm text-zinc-400">
						{shownId ? `「${nameOf(shownId)}」を表示中` : '表示なし'}{subId ? `（＋「${nameOf(subId)}」）` : ''}
					</div>
				</div>
				<button
					type="button"
					class="btn {soundOn ? 'btn-on' : ''}"
					aria-pressed={soundOn}
					onclick={() => (soundOn = !soundOn)}
				>
					{soundOn ? '音を消す' : '音を出す'}
				</button>
				<button type="button" class="btn" onclick={toggleFullscreen}>
					{fullscreen ? '全画面をやめる' : '全画面にする'}
				</button>
				<button
					type="button"
					class="btn {menuOpen ? 'btn-on' : ''}"
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = !menuOpen)}
				>
					その他
				</button>
			</div>

			{#if menuOpen}
				<div class="mt-3 space-y-3 border border-zinc-700 bg-zinc-950/95 p-4">
					<NameEditor
						name={session.name}
						label="このモニターの名前"
						onRename={(name) => session.rename(session.id, name)}
					/>
					{#if session.snapshot.settings.allowRecording}
						<RecordControl
							getStream={startMix}
							label={session.name}
							description="このモニターに映した映像を、切り替えも含めてそのまま録画します"
							onChange={(recording) => session.setStatus({ recording })}
							onStopped={stopMix}
						/>
					{/if}
					<details>
						<summary class="cursor-pointer text-sm text-zinc-300 hover:text-zinc-100">通信の状態</summary>
						<div class="mt-2 border border-zinc-800">
							<LinkStatsTable links={session.linkStats} {nameOf} />
						</div>
					</details>
					<p class="hint">
						音は最初は消してあります。このモニターから音を出したいときだけ「音を出す」を押してください。
					</p>
				</div>
			{/if}
		</div>
	</div>
</NodeShell>
