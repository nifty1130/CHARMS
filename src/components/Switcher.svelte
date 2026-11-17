<script lang="ts">
	import {
		isSourceRole,
		type Layout,
		type MonitorTarget,
		type NodeInfo,
		type QualityId
	} from '$lib/charms/protocol';
	import { AUDIO_MODES, AUDIO_MODE_ORDER } from '$lib/charms/audio';
	import { QUALITY_ORDER, QUALITY_PRESETS } from '$lib/charms/quality';
	import { secondaryOf } from '$lib/charms/routing';
	import type { SwitcherApi } from '$lib/charms/switcher-api';
	import NetBadge from './NetBadge.svelte';
	import VideoView from './VideoView.svelte';

	interface Props {
		/** 切り替えの操作先（ホスト自身、またはホストにつながったスイッチャー） */
		api: SwitcherApi;
	}

	let { api }: Props = $props();

	const MODE_KEY = 'charms:switcher:two-stage';

	const LAYOUT_OPTIONS: { id: Layout; label: string; detail: string }[] = [
		{ id: 'single', label: '1画面', detail: '重ねずに、ふつうに映す' },
		{ id: 'pip', label: 'ワイプ', detail: '隅に小さく重ねる' },
		{ id: 'split', label: '2画面', detail: '左右に並べる' },
		{ id: 'overlay', label: 'テロップを重ねる', detail: '文字だけを映像の上に出す' }
	];

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

	/** 選んでいるモニターの、画面の作り方（モニターによって違うときは null） */
	const currentLayout = $derived.by<Layout | null>(() => {
		const layouts = new Set(targetRoutes.map((route) => route.layout ?? 'single'));
		return layouts.size === 1 ? [...layouts][0] : null;
	});
	/** 選んでいるモニターに重ねている映像（モニターによって違うとき、重ねていないときは null） */
	const currentSub = $derived.by<string | null>(() => {
		const subs = new Set(targetRoutes.map((route) => secondaryOf(route)));
		return subs.size === 1 ? [...subs][0] : null;
	});

	function chooseLayout(layout: Layout) {
		if (!hasTarget) return;
		if (layout === 'single') {
			api.setLayout(target, 'single', null);
			return;
		}
		let sub = currentSub;
		if (!sub) {
			// 重ねる映像がまだ選ばれていなければ、それらしいものを選んでおく
			// （テロップ重ねならテロップ、それ以外は本番に出ていないカメラ）
			const onAir = new Set(targetRoutes.map((route) => route.program));
			const free = sources.filter((source) => source.live && !onAir.has(source.id));
			const wanted = layout === 'overlay' ? 'admin' : 'camera';
			sub = (free.find((source) => source.role === wanted) ?? free[0])?.id ?? null;
		}
		api.setLayout(target, layout, sub);
	}

	function chooseSub(sourceId: string) {
		if (!hasTarget) return;
		api.setLayout(target, currentLayout && currentLayout !== 'single' ? currentLayout : 'pip', sourceId);
	}

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
			preview: preview > 0,
			sub: sourceId !== null && targetRoutes.some((route) => secondaryOf(route) === sourceId)
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

	let zoomTimer: ReturnType<typeof setTimeout> | undefined;
	let zoomPending: { id: string; value: number } | null = null;

	/** つまみを動かしている間、ズームの指示を送りすぎないように間引く */
	function remoteZoom(id: string, value: number) {
		zoomPending = { id, value };
		if (zoomTimer) return;
		zoomTimer = setTimeout(() => {
			zoomTimer = undefined;
			if (zoomPending) api.cameraControl(zoomPending.id, { action: 'zoom', value: zoomPending.value });
			zoomPending = null;
		}, 120);
	}

	const CUE_PRESETS = ['寄って', '引いて', 'そのまま', '次いくよ', 'ピントを確認', '音を確認'];

	/** 指示の送り先（'all' か、端末の ID） */
	let cueTarget = $state('all');
	let cueDraft = $state('');
	let cueSent = $state<string | null>(null);

	// 送り先に選んでいた端末がいなくなったら、「全員」に戻す
	$effect(() => {
		if (cueTarget !== 'all' && !sources.some((source) => source.id === cueTarget)) cueTarget = 'all';
	});

	function sendCue(text: string) {
		const cue = text.trim();
		if (!cue || sources.length === 0) return;
		api.sendCue(cueTarget === 'all' ? 'all' : [cueTarget], cue);
		cueSent = `${cueTarget === 'all' ? '全員' : nameOf(cueTarget)}に「${cue}」と送りました`;
		cueDraft = '';
	}

	const recordingCount = $derived(api.snapshot.nodes.filter((node) => node.recording).length);

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
							<span class="flex items-center gap-1 text-xs font-normal"><NetBadge net={monitor.net} /></span>
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
								{#if use.sub}
									<span class="bg-sky-600 px-2 py-0.5 text-xs font-bold text-white">重ね</span>
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
									<NetBadge net={source.net} />
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

						{#if editing.zoom || editing.torch !== undefined}
							<div>
								<span class="text-sm text-zinc-300">ズーム・ライト（カメラ端末を遠隔で操作します）</span>
								<div class="mt-1 flex flex-wrap items-center gap-3">
									{#if editing.zoom}
										<input
											type="range"
											class="min-w-40 flex-1 accent-zinc-100"
											min={editing.zoom.min}
											max={editing.zoom.max}
											step={editing.zoom.step}
											value={editing.zoom.value}
											aria-label="{editing.name} のズーム"
											oninput={(event) => remoteZoom(editing.id, Number(event.currentTarget.value))}
										/>
									{/if}
									{#if editing.torch !== undefined}
										<button
											type="button"
											class="btn {editing.torch ? 'btn-on' : ''}"
											aria-pressed={editing.torch}
											onclick={() => api.cameraControl(editing.id, { action: 'torch', on: !editing.torch })}
										>
											{editing.torch ? 'ライトを消す' : 'ライトを点ける'}
										</button>
									{/if}
								</div>
							</div>
						{/if}

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

	<!-- もう1つの映像を重ねる・並べる -->
	<section class="panel" aria-label="重ねる・並べる">
		<div class="panel-head">
			<h2 class="panel-title">③ もう1つの映像を重ねる・並べる</h2>
			<span class="hint">ワイプ・2画面・テロップ</span>
		</div>
		<div class="space-y-3 p-3">
			<div class="flex flex-wrap gap-2" role="group" aria-label="画面の作り方">
				{#each LAYOUT_OPTIONS as option (option.id)}
					<button
						type="button"
						class="btn h-auto flex-col items-start gap-0 py-2 text-left {currentLayout === option.id
							? 'btn-on'
							: ''}"
						aria-pressed={currentLayout === option.id}
						disabled={!hasTarget}
						onclick={() => chooseLayout(option.id)}
					>
						<span class="text-sm font-semibold">{option.label}</span>
						<span class="text-xs font-normal opacity-70">{option.detail}</span>
					</button>
				{/each}
			</div>

			{#if currentLayout !== 'single'}
				<div>
					<span class="text-sm text-zinc-300">重ねる（並べる）映像</span>
					<div class="mt-1 flex flex-wrap gap-2" role="group" aria-label="重ねる映像">
						{#each sources as source (source.id)}
							<button
								type="button"
								class="btn {currentSub === source.id ? 'btn-on' : ''}"
								aria-pressed={currentSub === source.id}
								disabled={!source.live || !hasTarget}
								onclick={() => chooseSub(source.id)}
							>
								{source.name}
							</button>
						{:else}
							<span class="hint">カメラやテロップがつながると、ここで選べます。</span>
						{/each}
					</div>
					<p class="hint mt-2">
						上の「② どの映像を映すか」で選んだ映像が下地になり、ここで選んだ映像がその上（または右）に出ます。
						{#if currentLayout === 'overlay'}
							テロップは黒い部分が透けて、文字だけが重なります。
						{/if}
						音は、下地の映像のものだけが出ます。
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- カメラ担当への指示 -->
	<section class="panel" aria-label="指示を送る">
		<div class="panel-head">
			<h2 class="panel-title">④ カメラ担当に指示を送る</h2>
			<span class="hint">相手の画面に大きく表示されます</span>
		</div>
		<div class="space-y-3 p-3">
			<label class="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
				送り先
				<select class="field w-auto min-w-48" bind:value={cueTarget} disabled={sources.length === 0}>
					<option value="all">すべてのカメラ・テロップ</option>
					{#each sources as source (source.id)}
						<option value={source.id}>{source.name}</option>
					{/each}
				</select>
			</label>
			<div class="flex flex-wrap gap-2" role="group" aria-label="よく使う指示">
				{#each CUE_PRESETS as preset (preset)}
					<button type="button" class="btn" disabled={sources.length === 0} onclick={() => sendCue(preset)}>
						{preset}
					</button>
				{/each}
			</div>
			<form
				class="flex flex-wrap gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					sendCue(cueDraft);
				}}
			>
				<input
					class="field min-w-0 flex-1"
					bind:value={cueDraft}
					maxlength="60"
					placeholder="自由に書く（例: 3曲目の頭でステージ全体）"
					aria-label="指示の内容"
				/>
				<button type="submit" class="btn btn-primary" disabled={!cueDraft.trim() || sources.length === 0}>
					送る
				</button>
			</form>
			{#if cueSent}
				<p class="hint" role="status">{cueSent}</p>
			{/if}
		</div>
	</section>

	<!-- 録画の一斉操作（ホストが録画を許可しているときだけ） -->
	{#if api.snapshot.settings.allowRecording}
		<section class="panel" aria-label="録画をまとめて操作する">
			<div class="panel-head">
				<h2 class="panel-title">⑤ 録画をまとめて操作する</h2>
				<span class="hint">{recordingCount > 0 ? `${recordingCount}台が録画中` : '録画中の端末はありません'}</span>
			</div>
			<div class="space-y-2 p-3">
				<div class="flex flex-wrap gap-2">
					<button type="button" class="btn" onclick={() => api.recordAll(true)}>
						<span class="text-red-500" aria-hidden="true">●</span> 全端末で録画を始める
					</button>
					<button type="button" class="btn" disabled={recordingCount === 0} onclick={() => api.recordAll(false)}>
						■ 全端末の録画を止める
					</button>
				</div>
				<p class="hint">
					映像を出しているカメラ・テロップと、すべてのモニターで録画を始めます。ここから始めた録画は、止めたときに、それぞれの端末にファイルがダウンロードされます。長時間の録画は、各端末で「録画を始める」を押して保存先を選ぶ方法が安全です。
				</p>
			</div>
		</section>
	{/if}
</div>
