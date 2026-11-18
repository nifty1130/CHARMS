<script lang="ts">
	import {
		formatBytes,
		formatDuration,
		NO_DATA_MESSAGE,
		pickRecordingFormat,
		startRecording,
		type Recording
	} from '$lib/charms/recorder';
	import { onDestroy } from 'svelte';

	interface Props {
		/** 録画する映像を返す（録画を始める瞬間に呼ばれる。準備に時間がかかるときは Promise で返す） */
		getStream: () => MediaStream | null | Promise<MediaStream | null>;
		/** ファイル名に付ける名前 */
		label: string;
		/** 何を録画するのかの説明（「このカメラの映像」など） */
		description: string;
		/** 録画中に知らせておきたいこと（音なしで録画している、など） */
		notice?: string | null;
		/** 録画の開始・終了を知らせる */
		onChange?: (recording: boolean) => void;
		/** 録画を止めたあとの後片付け */
		onStopped?: () => void;
	}

	let { getStream, label, description, notice = null, onChange, onStopped }: Props = $props();

	let recording = $state<Recording | null>(null);
	let startedAt = $state(0);
	let now = $state(0);
	let bytes = $state(0);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const supported = pickRecordingFormat() !== null;

	$effect(() => {
		if (!recording) return;
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});

	async function start(remote = false) {
		error = null;
		busy = true;
		const stream = await getStream();
		if (!stream) {
			error = '録画できる映像がありません';
			busy = false;
			return;
		}
		try {
			const started = await startRecording(stream, {
				label,
				// 遠隔操作で始めるときは、保存先を選べない（止めたときにダウンロードする）
				picker: !remote,
				onProgress: (size) => (bytes = size),
				onEnd: (cause) => {
					recording = null;
					onChange?.(false);
					onStopped?.();
					if (cause) error = cause.message;
				}
			});
			if (!started) {
				// 保存先の選択をキャンセルした
				onStopped?.();
				return;
			}
			recording = started;
			startedAt = now = Date.now();
			bytes = 0;
			onChange?.(true);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '録画を始められませんでした';
			onStopped?.();
		} finally {
			busy = false;
		}
	}

	async function stop() {
		const current = recording;
		if (!current) return;
		busy = true;
		const saved = await current.stop();
		if (!saved) error = NO_DATA_MESSAGE;
		recording = null;
		busy = false;
		onChange?.(false);
		onStopped?.();
	}

	/** スイッチャーからの「一斉に録画」で始める */
	export function remoteStart(): void {
		console.info('[rec] remoteStart', !!recording, busy, supported);
		if (!recording && !busy && supported) void start(true);
	}

	/** スイッチャーからの「一斉に停止」で止める */
	export function remoteStop(): void {
		console.info('[rec] remoteStop', !!recording, busy);
		void stop();
	}

	onDestroy(() => {
		void recording?.stop();
	});
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
	{#if recording}
		<button type="button" class="btn btn-danger" onclick={stop} disabled={busy}>
			■ 録画を止めて保存
		</button>
		<span class="flex items-center gap-2 text-sm text-zinc-200" role="status">
			<span class="size-2.5 animate-pulse rounded-full bg-red-500"></span>
			録画中 <span class="font-mono">{formatDuration(now - startedAt)}</span>
			<span class="text-zinc-500">{formatBytes(bytes)}</span>
		</span>
		{#if notice}
			<p class="w-full text-sm text-amber-200">{notice}</p>
		{/if}
		{#if !recording.direct}
			<span class="hint">止めたときにダウンロードされます。長時間の録画は PC の Chrome / Edge が安全です。</span>
		{/if}
	{:else}
		<button type="button" class="btn" onclick={() => start()} disabled={busy || !supported}>
			<span class="text-red-500" aria-hidden="true">●</span> 録画を始める
		</button>
		<span class="hint">
			{supported ? description : 'このブラウザは録画に対応していません'}
		</span>
	{/if}
	{#if error}
		<p class="w-full text-sm text-red-300" role="alert">{error}</p>
	{/if}
</div>
