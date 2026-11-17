<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import TallyBanner from '../../components/TallyBanner.svelte';
	import VideoView from '../../components/VideoView.svelte';
	import {
		AUDIO_MODES,
		AUDIO_MODE_ORDER,
		DEFAULT_AUDIO_MODE,
		LevelMeter,
		audioConstraints
	} from '$lib/charms/audio';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { HOST_ID, type AudioMode, type QualityId } from '$lib/charms/protocol';
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
	/** この端末に付いているマイクの一覧 */
	let mics = $state.raw<MediaDeviceInfo[]>([]);
	let micId = $state<string | undefined>(undefined);
	/** 音声の送り方（端末に覚えさせておく） */
	let audioMode = $state<AudioMode>(loadAudioMode());
	let muted = $state(false);
	/** マイクの音量（0〜1） */
	let level = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const canShareScreen =
		typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

	const AUDIO_MODE_KEY = 'charms:camera:audio-mode';

	function loadAudioMode(): AudioMode {
		try {
			return localStorage.getItem('charms:camera:audio-mode') === 'music' ? 'music' : DEFAULT_AUDIO_MODE;
		} catch {
			return DEFAULT_AUDIO_MODE;
		}
	}

	const hasAudio = $derived((stream?.getAudioTracks().length ?? 0) > 0);
	const tally = $derived(tallyFor(session.id, session.snapshot.routes));
	const preset = $derived(QUALITY_PRESETS[quality]);
	/** 本番用の映像を送っているモニターの数 */
	const monitorCount = $derived(
		session.targets.filter(
			(id) => session.snapshot.nodes.find((node) => node.id === id)?.role === 'monitor'
		).length
	);
	const tooMany = $derived(monitorCount > preset.recommendedMonitors);

	// 前回選んだ音声の送り方を、映像接続にも伝えておく
	void session.media.setAudioMode(loadAudioMode());

	// スイッチャーからの遠隔操作を受ける
	session.onCameraCommand = (command) => {
		switch (command.action) {
			case 'quality':
				void changeQuality(command.quality);
				break;
			case 'flip':
				void flipCamera();
				break;
			case 'mute':
				setMuted(command.muted);
				break;
			case 'audio_mode':
				void changeAudio({ mode: command.mode });
				break;
		}
	};

	// 消音は、マイクを閉じずに「音を送らない」状態にする（解除したとき、すぐ音が戻る）
	$effect(() => {
		const enabled = !muted;
		stream?.getAudioTracks().forEach((track) => (track.enabled = enabled));
	});

	// マイクに音が入っているかを、メーターで見せる
	$effect(() => {
		const current = stream;
		if (!current || current.getAudioTracks().length === 0) {
			level = 0;
			return;
		}
		const meter = new LevelMeter(current, (value) => (level = value));
		return () => meter.destroy();
	});

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
			canFlip: sourceKind === 'webcam' && cameras.length > 1,
			hasAudio: (stream?.getAudioTracks().length ?? 0) > 0,
			muted,
			audioMode
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
			if (stream?.getVideoTracks()[0] === video) void stopSource();
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
				next = await navigator.mediaDevices.getUserMedia({
					video,
					audio: audioConstraints(audioMode, micId)
				});
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw cause;
				try {
					// 前に選んだマイクが外されていたときは、既定のマイクで試す
					next = await navigator.mediaDevices.getUserMedia({ video, audio: audioConstraints(audioMode) });
				} catch {
					// マイクがない端末では、映像だけで続ける
					next = await navigator.mediaDevices.getUserMedia({ video });
				}
			}

			const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
			cameras = devices.filter((device) => device.kind === 'videoinput');
			mics = devices.filter((device) => device.kind === 'audioinput');
			cameraId = next.getVideoTracks()[0]?.getSettings().deviceId;
			micId = next.getAudioTracks()[0]?.getSettings().deviceId;
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

	function setMuted(value: boolean) {
		muted = value;
		report();
	}

	/**
	 * 音声の送り方、または使うマイクを変える
	 *
	 * 映像はそのままで、マイクだけを開き直す。
	 */
	async function changeAudio(options: { mode?: AudioMode; deviceId?: string }) {
		const mode = options.mode ?? audioMode;
		const deviceId = options.deviceId ?? micId;
		if (mode === audioMode && deviceId === micId) return;
		audioMode = mode;
		try {
			localStorage.setItem(AUDIO_MODE_KEY, mode);
		} catch {
			// 保存できない環境では、次に開いたときに「会話向け」に戻るだけ
		}

		if (stream && sourceKind === 'webcam') {
			busy = true;
			error = null;
			try {
				// 同時に2つのマイクを開けない端末があるので、先にいまのマイクを閉じる
				stream.getAudioTracks().forEach((track) => track.stop());
				let audio: MediaStreamTrack[] = [];
				for (const constraints of [audioConstraints(mode, deviceId), audioConstraints(mode)]) {
					try {
						audio = (await navigator.mediaDevices.getUserMedia({ audio: constraints })).getAudioTracks();
						break;
					} catch {
						// 次の条件で試す
					}
				}
				if (audio.length === 0) error = 'マイクを使えませんでした。映像だけを送ります。';
				const next = new MediaStream([...stream.getVideoTracks(), ...audio]);
				micId = audio[0]?.getSettings().deviceId;
				stream = next;
				await session.media.setLocalStream(next);
			} finally {
				busy = false;
			}
		}
		await session.media.setAudioMode(mode);
		report();
	}

	function micLabel(mic: MediaDeviceInfo, index: number): string {
		return mic.label || `マイク ${index + 1}`;
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
					{#if hasAudio && muted}
						<span class="font-medium text-amber-300">マイク消音中</span>
					{/if}
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

				<section class="panel" aria-label="音声">
					<div class="panel-head">
						<h2 class="panel-title">音声</h2>
						{#if hasAudio}
							<button
								type="button"
								class="btn min-h-9 px-3 py-1 {muted ? 'btn-danger' : ''}"
								aria-pressed={muted}
								onclick={() => setMuted(!muted)}
							>
								{muted ? '消音を解除する' : 'マイクを消音する'}
							</button>
						{/if}
					</div>
					{#if hasAudio}
						<div class="space-y-3 p-4">
							<div>
								<div class="flex items-baseline justify-between text-sm text-zinc-300">
									<span>{sourceKind === 'screen' ? '画面の音の大きさ' : 'マイクの音の大きさ'}</span>
									<span class="text-xs text-zinc-500">
										{muted ? '消音中' : level > 0.92 ? '大きすぎます' : level < 0.02 ? '音が入っていません' : ''}
									</span>
								</div>
								<div
									class="mt-1 h-3 w-full overflow-hidden bg-zinc-800"
									role="meter"
									aria-label="音の大きさ"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(level * 100)}
								>
									<div
										class="h-full {level > 0.92 ? 'bg-red-500' : level > 0.75 ? 'bg-amber-400' : 'bg-emerald-400'}"
										style:width="{Math.round(level * 100)}%"
									></div>
								</div>
							</div>

							<div>
								<span class="text-sm text-zinc-300">音の送り方</span>
								<div class="mt-1 grid grid-cols-2 gap-px bg-zinc-800">
									{#each AUDIO_MODE_ORDER as id (id)}
										{@const item = AUDIO_MODES[id]}
										<button
											type="button"
											class="flex cursor-pointer flex-col items-center gap-0.5 px-2 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 {audioMode === id
												? 'bg-zinc-100 text-zinc-950'
												: 'bg-zinc-900 text-zinc-100 hover:bg-zinc-800'}"
											aria-pressed={audioMode === id}
											disabled={busy}
											onclick={() => changeAudio({ mode: id })}
										>
											<span class="text-base font-semibold">{item.label}</span>
											<span class="text-xs opacity-70">{item.detail}</span>
										</button>
									{/each}
								</div>
								{#if audioMode === 'music'}
									<p class="hint mt-2">
										演奏や歌を送るときに使います。この端末の近くでモニターの音を出すと、音が回り込んでハウリングすることがあります。
									</p>
								{/if}
							</div>

							{#if sourceKind === 'webcam' && mics.length > 1}
								<label class="block">
									<span class="text-sm text-zinc-300">使うマイク</span>
									<select
										class="field mt-1"
										value={micId}
										disabled={busy}
										onchange={(event) => changeAudio({ deviceId: event.currentTarget.value })}
									>
										{#each mics as mic, index (mic.deviceId)}
											<option value={mic.deviceId}>{micLabel(mic, index)}</option>
										{/each}
									</select>
								</label>
							{/if}
						</div>
					{:else}
						<p class="hint p-4">
							{sourceKind === 'screen'
								? '共有している画面には音が付いていません。音も送りたいときは、共有を始めるときに「音声も共有」を選んでください。'
								: 'マイクが使えないため、映像だけを送っています。'}
						</p>
					{/if}
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
