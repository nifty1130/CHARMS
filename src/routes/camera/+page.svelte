<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import TallyBanner from '../../components/TallyBanner.svelte';
	import VideoView from '../../components/VideoView.svelte';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { HOST_ID, type QualityId } from '$lib/charms/protocol';
	import {
		DEFAULT_QUALITY,
		QUALITY_ORDER,
		QUALITY_PRESETS,
		videoConstraints
	} from '$lib/charms/quality';
	import { tallyFor } from '$lib/charms/routing';
	import { roleOf } from '$lib/roles';
	import { onDestroy } from 'svelte';

	const session = new ClientSession('camera');
	const role = roleOf('camera');

	/** 送り出している映像 */
	let stream = $state.raw<MediaStream | null>(null);
	let sourceKind = $state<'webcam' | 'screen' | null>(null);
	/** この端末に付いているカメラの一覧 */
	let cameras = $state.raw<MediaDeviceInfo[]>([]);
	let cameraId = $state<string | undefined>(undefined);
	let quality = $state<QualityId>(DEFAULT_QUALITY);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const canShareScreen =
		typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

	const tally = $derived(tallyFor(session.id, session.snapshot.routes));
	const preset = $derived(QUALITY_PRESETS[quality]);
	/** 本番用の映像を送っているモニターの数 */
	const monitorCount = $derived(
		session.targets.filter(
			(id) => session.snapshot.nodes.find((node) => node.id === id)?.role === 'monitor'
		).length
	);
	const tooMany = $derived(monitorCount > preset.recommendedMonitors);

	// スイッチャーからの遠隔操作を受ける
	session.onCameraCommand = (command) => {
		if (command.action === 'quality') void changeQuality(command.quality);
		else void flipCamera();
	};

	onDestroy(() => stopTracks(stream));

	function stopTracks(target: MediaStream | null) {
		target?.getTracks().forEach((track) => track.stop());
	}

	/** いまの状態をホストに知らせる */
	function report() {
		session.setStatus({
			live: stream !== null,
			quality,
			sourceKind: sourceKind ?? undefined,
			canFlip: sourceKind === 'webcam' && cameras.length > 1
		});
	}

	/** カメラやマイクを使えなかった理由を、分かる言葉にする */
	function explain(cause: unknown): string {
		const name = cause instanceof DOMException ? cause.name : '';
		if (name === 'NotAllowedError') {
			return 'カメラの使用が許可されていません。ブラウザのアドレス欄の横にあるカメラのマークから、許可に変えてください。';
		}
		if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			return 'この端末で使えるカメラが見つかりません。';
		}
		if (name === 'NotReadableError') {
			return 'カメラをほかのアプリが使っています。ほかのアプリを閉じてから、もう一度試してください。';
		}
		return '映像を取得できませんでした。もう一度試してください。';
	}

	async function useStream(next: MediaStream, kind: 'webcam' | 'screen') {
		const previous = stream;
		const video = next.getVideoTracks()[0];
		// 動きのあるカメラ映像は滑らかさを、文字の多い画面共有は鮮明さを優先して圧縮させる
		video.contentHint = kind === 'screen' ? 'detail' : 'motion';
		// 画面共有を「共有を停止」で止めたときなど、映像が終わったら送り出しも止める
		video.addEventListener('ended', () => {
			if (stream === next) void stopSource();
		});

		stream = next;
		sourceKind = kind;
		await session.media.setLocalStream(next);
		if (previous !== next) stopTracks(previous);
		report();
	}

	async function startWebcam(deviceId: string | undefined = undefined) {
		busy = true;
		error = null;
		try {
			// スマホでは同時に2つのカメラを開けないことがあるので、先にいまの映像を止める
			if (sourceKind === 'webcam') stream?.getVideoTracks().forEach((track) => track.stop());

			const video = videoConstraints(quality, deviceId);
			let next: MediaStream;
			try {
				next = await navigator.mediaDevices.getUserMedia({ video, audio: true });
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw cause;
				// マイクがない端末では、映像だけで続ける
				next = await navigator.mediaDevices.getUserMedia({ video });
			}

			const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
			cameras = devices.filter((device) => device.kind === 'videoinput');
			cameraId = next.getVideoTracks()[0]?.getSettings().deviceId;
			await useStream(next, 'webcam');
		} catch (cause) {
			error = explain(cause);
			if (stream && stream.getVideoTracks().every((track) => track.readyState === 'ended')) {
				await stopSource();
			}
		} finally {
			busy = false;
		}
	}

	async function startScreen() {
		busy = true;
		error = null;
		try {
			const next = await navigator.mediaDevices.getDisplayMedia({
				video: { frameRate: { ideal: preset.frameRate } },
				audio: true
			});
			await useStream(next, 'screen');
		} catch (cause) {
			// 共有する画面を選ばずに閉じただけなら、何も言わない
			if (!(cause instanceof DOMException && cause.name === 'NotAllowedError')) {
				error = '画面を共有できませんでした。もう一度試してください。';
			}
		} finally {
			busy = false;
		}
	}

	async function stopSource() {
		stopTracks(stream);
		stream = null;
		sourceKind = null;
		await session.media.setLocalStream(null);
		report();
	}

	async function changeQuality(next: QualityId) {
		quality = next;
		await session.media.setQuality(next);
		if (stream && sourceKind === 'webcam') {
			await stream
				.getVideoTracks()[0]
				?.applyConstraints(videoConstraints(next))
				.catch(() => {});
			// 解像度が変わったので、確認用の小さな映像の縮小率を計算し直す
			await session.media.setLocalStream(stream);
		}
		report();
	}

	/** 次のカメラに切り替える（前面 ↔ 背面など） */
	async function flipCamera() {
		if (sourceKind !== 'webcam' || cameras.length < 2 || busy) return;
		const index = cameras.findIndex((camera) => camera.deviceId === cameraId);
		await startWebcam(cameras[(index + 1) % cameras.length].deviceId);
	}

	function cameraLabel(camera: MediaDeviceInfo, index: number): string {
		return camera.label || `カメラ ${index + 1}`;
	}

	function targetName(id: string): string {
		if (id === HOST_ID) return 'ホスト（確認用）';
		const node = session.snapshot.nodes.find((n) => n.id === id);
		if (!node) return id;
		return node.role === 'monitor' ? node.name : `${node.name}（確認用）`;
	}
</script>

<svelte:head>
	<title>カメラ — CHARM Point</title>
</svelte:head>

<NodeShell {session} {role}>
	{#if !stream}
		<!-- 映像を選ぶ -->
		<section class="panel">
			<div class="panel-head">
				<h1 class="panel-title">送る映像を選んでください</h1>
			</div>
			<div class="grid grid-cols-1 gap-px bg-zinc-800 sm:grid-cols-2">
				<button
					type="button"
					class="flex cursor-pointer flex-col items-start gap-2 bg-zinc-900 p-6 text-left transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={busy}
					onclick={() => startWebcam()}
				>
					<span class="text-xl font-semibold">この端末のカメラ</span>
					<span class="hint">スマホやタブレット、PC のカメラで撮った映像を送ります。</span>
					<span class="mt-2 text-sm font-medium text-zinc-300">カメラを始める →</span>
				</button>
				<button
					type="button"
					class="flex cursor-pointer flex-col items-start gap-2 bg-zinc-900 p-6 text-left transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={busy || !canShareScreen}
					onclick={startScreen}
				>
					<span class="text-xl font-semibold">この端末の画面</span>
					<span class="hint">
						{canShareScreen
							? 'スライドや動画など、この PC の画面をそのまま映像として送ります。'
							: 'この端末（スマホなど）は画面の共有に対応していません。PC で開いてください。'}
					</span>
					{#if canShareScreen}
						<span class="mt-2 text-sm font-medium text-zinc-300">画面の共有を始める →</span>
					{/if}
				</button>
			</div>
			{#if busy}
				<p class="hint border-t border-zinc-800 px-4 py-3">準備しています…</p>
			{/if}
			{#if error}
				<p class="border-t border-zinc-800 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
					{error}
				</p>
			{/if}
		</section>
	{:else}
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
			<!-- 送っている映像 -->
			<section class="panel lg:col-span-3">
				<TallyBanner {tally} nodes={session.snapshot.nodes} />
				<VideoView {stream} fit="contain" class="aspect-video w-full" />
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 px-4 py-2 text-sm text-zinc-400">
					<span class="text-zinc-200">{sourceKind === 'screen' ? '画面を共有中' : 'カメラで撮影中'}</span>
					<span>送り先: {session.targets.length > 0 ? session.targets.map(targetName).join('、') : 'まだありません'}</span>
				</div>
			</section>

			<!-- 設定 -->
			<div class="space-y-4 lg:col-span-2">
				<section class="panel">
					<div class="panel-head"><h2 class="panel-title">画質</h2></div>
					<div class="grid grid-cols-3 gap-px bg-zinc-800">
						{#each QUALITY_ORDER as id (id)}
							{@const item = QUALITY_PRESETS[id]}
							<button
								type="button"
								class="flex cursor-pointer flex-col items-center gap-0.5 px-2 py-3 text-center transition-colors {quality === id
									? 'bg-zinc-100 text-zinc-950'
									: 'bg-zinc-900 text-zinc-100 hover:bg-zinc-800'}"
								aria-pressed={quality === id}
								onclick={() => changeQuality(id)}
							>
								<span class="text-base font-semibold">{item.label}</span>
								<span class="text-xs opacity-70">{item.detail}</span>
								<span class="text-xs opacity-70">モニター{item.recommendedMonitors}台まで</span>
							</button>
						{/each}
					</div>
					<p class="hint px-4 py-3 {tooMany ? 'text-amber-200' : ''}">
						{#if tooMany}
							いま{monitorCount}台のモニターに送っています。映像がカクつくときは、画質を下げてください。
						{:else}
							「モニター◯台まで」は、性能の低い端末での目安です。送り先が増えるほど、この端末の負担が大きくなります。
						{/if}
					</p>
				</section>

				<section class="panel space-y-3 p-4">
					{#if sourceKind === 'webcam' && cameras.length > 1}
						<label class="block">
							<span class="text-sm text-zinc-300">使うカメラ</span>
							<select
								class="field mt-1"
								value={cameraId}
								disabled={busy}
								onchange={(event) => startWebcam(event.currentTarget.value)}
							>
								{#each cameras as camera, index (camera.deviceId)}
									<option value={camera.deviceId}>{cameraLabel(camera, index)}</option>
								{/each}
							</select>
						</label>
					{/if}
					<div class="flex flex-wrap gap-2">
						{#if sourceKind === 'webcam' && canShareScreen}
							<button type="button" class="btn" disabled={busy} onclick={startScreen}>画面の共有に変える</button>
						{:else if sourceKind === 'screen'}
							<button type="button" class="btn" disabled={busy} onclick={() => startWebcam()}>カメラに変える</button>
						{/if}
						<button type="button" class="btn" disabled={busy} onclick={stopSource}>映像を止める</button>
					</div>
					{#if error}
						<p class="text-sm text-red-300" role="alert">{error}</p>
					{/if}
				</section>

				<section class="panel space-y-3 p-4">
					<NameEditor
						name={session.name}
						label="このカメラの名前"
						onRename={(name) => session.rename(session.id, name)}
					/>
					{#if session.snapshot.settings.allowRecording}
						<RecordControl
							getStream={() => stream}
							label={session.name}
							description="このカメラで撮ったままの映像を録画します"
							onChange={(recording) => session.setStatus({ recording })}
						/>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</NodeShell>
