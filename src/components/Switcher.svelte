<script lang="ts">
	import {
		isSourceRole,
		type MonitorTarget,
		type NodeInfo,
		type QualityId
	} from '$lib/charms/protocol';
	import { AUDIO_MODES, AUDIO_MODE_ORDER } from '$lib/charms/audio';
	import { QUALITY_ORDER, QUALITY_PRESETS } from '$lib/charms/quality';
	import type { SwitcherApi } from '$lib/charms/switcher-api';
	import VideoView from './VideoView.svelte';

	interface Props {
		/** 切り替えの操作先（ホスト自身、またはホストにつながったスイッチャー） */
		api: SwitcherApi;
	}

	let { api }: Props = $props();

	const MODE_KEY = 'charms:switcher:two-stage';

	const sources = $derived(api.snapshot.nodes.filter((node) => isSourceRole(node.role)));
	const monitors = $derived(api.snapshot.nodes.filter((node) => node.role === 'monitor'));
	const routes = $derived(api.snapshot.routes);

	/** 「すべてのモニター」を対象にしているか */
	let pickAll = $state(true);
	/** 個別に選んだモニター */
	let picked = $state<string[]>([]);
	/** 予告してから切り替える方式か */
	let twoStage = $state(false);
	/** 設定を開いている映像入力 */
	let editingId = $state<string | null>(null);
	let nameDraft = $state('');

	$effect(() => {
		try {
			twoStage = localStorage.getItem(MODE_KEY) === '1';
		} catch {
			// 保存できない環境では、毎回「すぐ切り替える」から始める
		}
	});

	function setTwoStage(value: boolean) {
		twoStage = value;
		try {
			localStorage.setItem(MODE_KEY, value ? '1' : '0');
		} catch {
			// 上と同じ
		}
	}

	const targetIds = $derived(
		pickAll
			? monitors.map((monitor) => monitor.id)
			: picked.filter((id) => monitors.some((monitor) => monitor.id === id))
	);
	const target = $derived<MonitorTarget>(pickAll ? 'all' : targetIds);
	const targetRoutes = $derived(routes.filter((route) => targetIds.includes(route.monitorId)));
	const hasTarget = $derived(targetIds.length > 0);
	const canTake = $derived(
		targetRoutes.some((route) => route.preview && route.preview !== route.program)
	);
	const editing = $derived(sources.find((source) => source.id === editingId) ?? null);

	function nameOf(id: string | null): string {
		if (!id) return 'なし';
		return api.snapshot.nodes.find((node) => node.id === id)?.name ?? 'なし';
	}

	function toggleMonitor(id: string) {
		if (pickAll) {
			pickAll = false;
			picked = [id];
		} else if (picked.includes(id)) {
			picked = picked.filter((other) => other !== id);
		} else {
			picked = [...picked, id];
		}
	}

	/** 選んでいるモニターのうち、いくつでこの映像が本番・予告になっているか */
	function usage(sourceId: string | null) {
		const program = targetRoutes.filter((route) => route.program === sourceId).length;
		const preview = targetRoutes.filter(
			(route) => route.preview === sourceId && route.program !== sourceId
		).length;
		const total = targetRoutes.length;
		return {
			program: total > 0 && program === total ? 'all' : program > 0 ? 'some' : 'none',
			preview: preview > 0
		} as const;
	}

	function choose(sourceId: string | null) {
		if (!hasTarget) return;
		api.route(target, twoStage ? 'preview' : 'program', sourceId);
	}

	function take() {
		if (hasTarget && canTake) api.take(target);
	}

	function openSettings(source: NodeInfo) {
		if (editingId === source.id) {
			editingId = null;
			return;
		}
		editingId = source.id;
		nameDraft = source.name;
	}

	function saveName() {
		if (editing && nameDraft.trim()) api.rename(editing.id, nameDraft);
	}

	function setQuality(quality: QualityId) {
		if (editing) api.cameraControl(editing.id, { action: 'quality', quality });
	}

	function kindLabel(source: NodeInfo): string {
		if (source.role === 'admin') return 'テロップ';
		return source.sourceKind === 'screen' ? '画面共有' : 'カメラ';
	}

	/** キーボードでの操作（1〜9: 映像を選ぶ / 0: 黒画面 / Enter: 切り替える） */
	function onKeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
		const element = event.target as HTMLElement | null;
		if (element?.closest('input, textarea, select, [contenteditable]')) return;

		if (event.key >= '1' && event.key <= '9') {
			const source = sources[Number(event.key) - 1];
			if (source?.live) choose(source.id);
		} else if (event.key === '0') {
			choose(null);
		} else if (event.key === 'Enter' && twoStage && canTake) {
			// ボタンにフォーカスがあるときは、そのボタンの動作を優先する
			if (element?.closest('button, a, summary')) return;
			event.preventDefault();
			take();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="space-y-4">
	<!-- 出力先 -->
	<section class="panel">
		<div class="panel-head">
			<h2 class="panel-title">① どのモニターに映すか</h2>
			<span class="hint">
				{#if monitors.length === 0}
					モニターがまだつながっていません
				{:else if pickAll}
					すべてのモニター（{monitors.length}台）が対象
				{:else}
					{targetIds.length}台を選択中
				{/if}
			</span>
		</div>
		<div class="flex flex-wrap gap-2 p-3">
			<button
				type="button"
				class="btn {pickAll ? 'btn-on' : ''}"
				aria-pressed={pickAll}
				disabled={monitors.length === 0}
				onclick={() => {
					pickAll = true;
					picked = [];
				}}
			>
				すべてのモニター
			</button>
			{#each monitors as monitor (monitor.id)}
				{@const route = routes.find((r) => r.monitorId === monitor.id)}
				{@const on = !pickAll && picked.includes(monitor.id)}
				<div class="flex">
					<button
						type="button"
						class="btn h-auto flex-col items-start gap-0.5 py-2 text-left {on ? 'btn-on' : ''}"
						aria-pressed={on}
						onclick={() => toggleMonitor(monitor.id)}
					>
						<span class="flex items-center gap-2 text-sm font-semibold">
							{monitor.name}
							{#if monitor.recording}
								<span class="text-xs font-medium text-red-500">● 録画中</span>
							{/if}
						</span>
						<span class="flex items-center gap-1.5 text-xs font-normal {on ? 'text-zinc-700' : 'text-zinc-400'}">
							<span class="size-2 rounded-full bg-red-500"></span>本番: {nameOf(route?.program ?? null)}
							{#if route?.preview}
								<span class="ml-2 size-2 rounded-full bg-emerald-500"></span>予告: {nameOf(route.preview)}
							{/if}
						</span>
					</button>
					<!-- モニターの音を、手元から出す・消す -->
					<button
						type="button"
						class="btn -ml-px h-auto flex-col gap-0 px-2.5 py-2 text-xs {monitor.sound
							? 'border-emerald-500/70 text-emerald-300'
							: 'text-zinc-400'}"
						aria-pressed={!!monitor.sound}
						aria-label="{monitor.name} の音を{monitor.sound ? '消す' : '出す'}"
						onclick={() => api.monitorControl(monitor.id, { action: 'sound', on: !monitor.sound })}
					>
						<span>音</span>
						<span class="font-semibold">{monitor.sound ? '出ている' : '消音'}</span>
					</button>
				</div>
			{/each}
		</div>
	</section>

	<!-- 映像を選ぶ -->
	<section class="panel">
		<div class="panel-head">
			<h2 class="panel-title">② どの映像を映すか</h2>
			<div class="flex" role="group" aria-label="切り替え方">
				<button
					type="button"
					class="btn min-h-9 px-3 py-1 {twoStage ? '' : 'btn-on'}"
					aria-pressed={!twoStage}
					onclick={() => setTwoStage(false)}
				>
					押したらすぐ切り替える
				</button>
				<button
					type="button"
					class="btn -ml-px min-h-9 px-3 py-1 {twoStage ? 'btn-on' : ''}"
					aria-pressed={twoStage}
					onclick={() => setTwoStage(true)}
				>
					予告してから切り替える
				</button>
			</div>
		</div>

		{#if !hasTarget && monitors.length > 0}
			<p class="border-b border-zinc-800 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
				上で、映したいモニターを選んでください。
			</p>
		{/if}

		{#if sources.length === 0}
			<p class="hint p-6 text-center">
				カメラやテロップがまだつながっていません。<br />つながると、ここに映像が並びます。
			</p>
		{:else}
			<div class="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-4">
				{#each sources as source, index (source.id)}
					{@const use = usage(source.id)}
					<div
						class="flex flex-col border-2 bg-zinc-950 {use.program === 'all'
							? 'border-red-500'
							: use.program === 'some'
								? 'border-dashed border-red-500'
								: use.preview
									? 'border-emerald-500'
									: 'border-zinc-800'}"
					>
						<button
							type="button"
							class="group relative block aspect-video w-full cursor-pointer overflow-hidden bg-black disabled:cursor-not-allowed"
							disabled={!source.live || !hasTarget}
							onclick={() => choose(source.id)}
							aria-label="{source.name} を{twoStage ? '予告に入れる' : '映す'}"
						>
							{#if source.live && api.thumbnails[source.id]}
								<VideoView
									stream={api.thumbnails[source.id]}
									fit="contain"
									class="h-full w-full transition-opacity group-hover:opacity-80"
								/>
							{:else}
								<span class="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
									{source.live ? '映像を受け取っています…' : '映像なし（準備中）'}
								</span>
							{/if}

							{#if index < 9}
								<span
									class="absolute top-1.5 left-1.5 flex size-6 items-center justify-center bg-zinc-950/80 font-mono text-sm text-zinc-200"
									aria-hidden="true"
								>
									{index + 1}
								</span>
							{/if}
							<span class="absolute top-1.5 right-1.5 flex gap-1">
								{#if use.program !== 'none'}
									<span class="bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
										本番{use.program === 'some' ? '（一部）' : ''}
									</span>
								{/if}
								{#if use.preview}
									<span class="bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">予告</span>
								{/if}
							</span>
						</button>

						<div class="flex items-center justify-between gap-2 px-2.5 py-1.5">
							<div class="min-w-0">
								<div class="truncate text-sm font-semibold text-zinc-100">{source.name}</div>
								<div class="flex items-center gap-2 text-xs text-zinc-500">
									<span>{kindLabel(source)}</span>
									{#if source.recording}
										<span class="font-medium text-red-500">● 録画中</span>
									{/if}
									{#if source.hasAudio && source.muted}
										<span class="font-medium text-amber-300">マイク消音中</span>
									{/if}
								</div>
							</div>
							<button
								type="button"
								class="btn btn-quiet shrink-0 {editingId === source.id ? 'border-zinc-600 text-zinc-100' : ''}"
								aria-expanded={editingId === source.id}
								onclick={() => openSettings(source)}
							>
								設定
							</button>
						</div>
					</div>
				{/each}

				<!-- 何も映さない -->
				<div
					class="flex flex-col border-2 bg-zinc-950 {usage(null).program === 'all' && hasTarget
						? 'border-red-500'
						: 'border-zinc-800'}"
				>
					<button
						type="button"
						class="relative flex aspect-video w-full cursor-pointer items-center justify-center bg-black text-sm text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed"
						disabled={!hasTarget}
						onclick={() => choose(null)}
					>
						<span
							class="absolute top-1.5 left-1.5 flex size-6 items-center justify-center bg-zinc-900 font-mono text-sm text-zinc-200"
							aria-hidden="true">0</span
						>
						何も映さない
					</button>
					<div class="px-2.5 py-1.5">
						<div class="text-sm font-semibold text-zinc-100">黒画面</div>
						<div class="text-xs text-zinc-500">映像を止める</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- 選んだ映像入力の設定（遠隔操作） -->
		{#if editing}
			<div class="border-t border-zinc-800 bg-zinc-950/50 p-4">
				<div class="flex items-center justify-between gap-3">
					<h3 class="text-base font-semibold">「{editing.name}」の設定</h3>
					<button type="button" class="btn btn-quiet" onclick={() => (editingId = null)}>閉じる</button>
				</div>
				<div class="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
					<form
						class="flex items-end gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							saveName();
						}}
					>
						<label class="min-w-0 flex-1">
							<span class="text-sm text-zinc-300">名前</span>
							<input class="field mt-1" bind:value={nameDraft} maxlength="24" />
						</label>
						<button type="submit" class="btn" disabled={!nameDraft.trim() || nameDraft === editing.name}>
							変更
						</button>
					</form>

					{#if editing.role === 'camera'}
						<div>
							<span class="text-sm text-zinc-300">画質（カメラ端末を遠隔で切り替えます）</span>
							<div class="mt-1 flex flex-wrap gap-2">
								{#each QUALITY_ORDER as quality (quality)}
									{@const preset = QUALITY_PRESETS[quality]}
									<button
										type="button"
										class="btn h-auto flex-col gap-0 py-1.5 {editing.quality === quality ? 'btn-on' : ''}"
										aria-pressed={editing.quality === quality}
										onclick={() => setQuality(quality)}
									>
										<span>{preset.label}</span>
										<span class="text-xs font-normal opacity-70">{preset.detail}</span>
									</button>
								{/each}
								{#if editing.canFlip}
									<button
										type="button"
										class="btn"
										onclick={() => api.cameraControl(editing.id, { action: 'flip' })}
									>
										別のカメラに切り替える
									</button>
								{/if}
							</div>
						</div>

						{#if editing.hasAudio}
							<div>
								<span class="text-sm text-zinc-300">音声（カメラ端末を遠隔で切り替えます）</span>
								<div class="mt-1 flex flex-wrap gap-2">
									<button
										type="button"
										class="btn {editing.muted ? 'btn-danger' : ''}"
										aria-pressed={!!editing.muted}
										onclick={() =>
											api.cameraControl(editing.id, { action: 'mute', muted: !editing.muted })}
									>
										{editing.muted ? 'マイクの消音を解除する' : 'マイクを消音する'}
									</button>
									{#each AUDIO_MODE_ORDER as mode (mode)}
										<button
											type="button"
											class="btn {(editing.audioMode ?? 'voice') === mode ? 'btn-on' : ''}"
											aria-pressed={(editing.audioMode ?? 'voice') === mode}
											onclick={() => api.cameraControl(editing.id, { action: 'audio_mode', mode })}
										>
											{AUDIO_MODES[mode].label}
										</button>
									{/each}
								</div>
								<p class="hint mt-1">
									「音楽向け」は、演奏や歌を高音質で送ります。切り替えるとき、映像と音が一瞬途切れます。
								</p>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}

		<!-- 予告 → 本番 -->
		{#if twoStage}
			<div class="flex flex-wrap items-center gap-4 border-t border-zinc-800 p-3">
				<button type="button" class="btn btn-danger min-h-14 px-8 text-lg font-bold" disabled={!canTake} onclick={take}>
					切り替える
				</button>
				<p class="hint min-w-0 flex-1">
					{#if canTake}
						<span class="text-emerald-300">予告</span>の映像を<span class="text-red-400">本番</span
						>に出します。（Enter キーでも切り替えられます）
					{:else}
						映像を押すと<span class="text-emerald-300">予告</span
						>に入ります。モニターにはまだ出ません。
					{/if}
				</p>
			</div>
		{/if}
	</section>
</div>
