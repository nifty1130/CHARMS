<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import VideoView from '../../components/VideoView.svelte';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { ProgramMixer } from '$lib/charms/recorder';
	import { roleOf } from '$lib/roles';
	import { onMount, untrack } from 'svelte';

	const session = new ClientSession('monitor');
	const role = roleOf('monitor');

	/** ホストから指示された「いま映すべき映像」 */
	const programId = $derived(
		session.snapshot.routes.find((route) => route.monitorId === session.id)?.program ?? null
	);
	const sourceIds = $derived(Object.keys(session.streams));

	/** 実際に画面に出している映像 */
	let shownId = $state<string | null>(null);
	/** 絵が出始めた映像（ストリームごとに覚える） */
	const playing = new WeakSet<MediaStream>();
	/** playing が変わったことを画面に伝えるためのカウンター */
	let playingVersion = $state(0);

	let videos = $state<Record<string, HTMLVideoElement>>({});
	let soundOn = $state(false);
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
	});

	// つながり直したら、つなぎ直しの画面を閉じる
	$effect(() => {
		if (session.connected) reconnecting = false;
	});

	onMount(() => {
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
		return mixer.stream;
	}

	function stopMix() {
		mixer?.destroy();
		mixer = null;
	}
</script>

<svelte:head>
	<title>モニター — CHARMS</title>
</svelte:head>

<NodeShell {session} {role} bare hold={session.lost && !reconnecting}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 overflow-hidden bg-black {controlsVisible ? '' : 'cursor-none'}"
		onpointermove={wake}
		onpointerdown={wake}
	>
		<!-- 受け取っている映像を重ねて置き、いま映すものだけを見せる。
		     予告の映像も裏で再生しておくので、切り替えが一瞬で済む -->
		{#each sourceIds as id (id)}
			<VideoView
				stream={session.streams[id]}
				muted={!(soundOn && id === shownId)}
				bind:element={videos[id]}
				onPlaying={() => markPlaying(id)}
				class="absolute inset-0 h-full w-full {id === shownId ? 'opacity-100' : 'opacity-0'}"
			/>
		{/each}

		<!-- 何も映していないとき -->
		{#if shownId === null}
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
		{#if !session.connected}
			<div class="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-red-950/90 px-4 py-3 text-center">
				<span class="text-base text-red-100">
					ホストとの接続が切れました。{shownId ? 'いまの映像は出し続けますが、切り替えはできません。' : ''}
				</span>
				<button type="button" class="btn" onclick={() => (reconnecting = true)}>ホストとつなぎ直す</button>
			</div>
		{/if}

		<!-- 操作パネル（画面に触れると出る） -->
		<div
			class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pt-10 pb-4 transition-opacity duration-300 {controlsVisible
				? 'opacity-100'
				: 'pointer-events-none opacity-0'}"
		>
			<div class="flex flex-wrap items-center gap-3">
				<div class="mr-auto min-w-0">
					<div class="truncate text-base font-semibold text-zinc-100">{session.name}</div>
					<div class="text-sm text-zinc-400">
						{shownId ? `「${nameOf(shownId)}」を表示中` : '表示なし'}
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
					<p class="hint">
						音は最初は消してあります。このモニターから音を出したいときだけ「音を出す」を押してください。
					</p>
				</div>
			{/if}
		</div>
	</div>
</NodeShell>
