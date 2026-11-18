<script lang="ts">
	import TelopLayer from './TelopLayer.svelte';
	import {
		BUILTIN_TEMPLATES,
		cloneTemplate,
		isBuiltinTemplate,
		textOf,
		type TelopFrame,
		type TelopScene,
		type TelopTemplate
	} from '$lib/charms/telop';

	/**
	 * 型（テンプレート）の調整
	 *
	 * プレビューの上で枠をドラッグして動かし、右下の角で大きさを変える。
	 * 文字の大きさ・色・帯などは、選んだ枠ごとに変える。変えた内容は、すぐ端末に保存される。
	 */
	interface Props {
		/** 型の一覧（ここで書き換える） */
		templates: TelopTemplate[];
		/** いま出している場面（同じ型なら、プレビューにその文字を使う） */
		scene: TelopScene | null;
	}

	let { templates = $bindable(), scene }: Props = $props();

	let selectedId = $state(templates[0]?.id ?? '');
	let frameId = $state<string | null>(null);
	let box: HTMLDivElement | undefined = $state();

	const template = $derived(templates.find((t) => t.id === selectedId) ?? templates[0]);
	const frame = $derived(template?.frames.find((f) => f.id === frameId) ?? template?.frames[0] ?? null);

	/** プレビューに出す文字（いま出している場面が同じ型ならその文字、なければ枠の名前） */
	const preview = $derived.by((): TelopScene | null => {
		if (!template) return null;
		if (scene && scene.template.id === template.id && Object.keys(scene.texts).length > 0) {
			return { template, texts: scene.texts };
		}
		return {
			template,
			texts: Object.fromEntries(template.frames.map((f) => [f.id, textOf(`${f.name}の文字`)]))
		};
	});

	const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
	const round = (value: number) => Math.round(value * 1000) / 1000;

	/** 枠のドラッグ（動かす・大きさを変える） */
	function startDrag(event: PointerEvent, target: TelopFrame, mode: 'move' | 'resize') {
		if (!box) return;
		event.preventDefault();
		event.stopPropagation();
		frameId = target.id;
		const rect = box.getBoundingClientRect();
		const start = { x: event.clientX, y: event.clientY, fx: target.x, fy: target.y, fw: target.w, fh: target.h };
		const element = event.currentTarget as HTMLElement;
		element.setPointerCapture(event.pointerId);

		const move = (e: PointerEvent) => {
			const dx = (e.clientX - start.x) / rect.width;
			const dy = (e.clientY - start.y) / rect.height;
			if (mode === 'move') {
				target.x = round(Math.min(1 - target.w, Math.max(0, start.fx + dx)));
				target.y = round(Math.min(1 - target.h, Math.max(0, start.fy + dy)));
			} else {
				target.w = round(Math.min(1 - target.x, Math.max(0.05, start.fw + dx)));
				target.h = round(Math.min(1 - target.y, Math.max(0.04, start.fh + dy)));
			}
		};
		const end = () => {
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerup', end);
			element.removeEventListener('pointercancel', end);
		};
		element.addEventListener('pointermove', move);
		element.addEventListener('pointerup', end);
		element.addEventListener('pointercancel', end);
	}

	/** キーボードでも枠を動かせるようにする（矢印キー。Shift で大きさを変える） */
	function nudge(event: KeyboardEvent, target: TelopFrame) {
		const step = 0.01;
		const delta: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const d = delta[event.key];
		if (!d) return;
		event.preventDefault();
		if (event.shiftKey) {
			target.w = round(Math.min(1 - target.x, Math.max(0.05, target.w + d[0])));
			target.h = round(Math.min(1 - target.y, Math.max(0.04, target.h + d[1])));
		} else {
			target.x = round(Math.min(1 - target.w, Math.max(0, target.x + d[0])));
			target.y = round(Math.min(1 - target.h, Math.max(0, target.y + d[1])));
		}
	}

	function duplicate() {
		if (!template) return;
		const copy = cloneTemplate($state.snapshot(template) as TelopTemplate);
		copy.id = `custom-${crypto.randomUUID().slice(0, 8)}`;
		let name = `${template.name}（コピー）`;
		for (let n = 2; templates.some((t) => t.name === name); n++) name = `${template.name}（コピー ${n}）`;
		copy.name = name;
		templates.push(copy);
		selectedId = copy.id;
	}

	function reset() {
		const original = BUILTIN_TEMPLATES.find((t) => t.id === template?.id);
		if (!original) return;
		const index = templates.findIndex((t) => t.id === original.id);
		templates[index] = cloneTemplate(original);
	}

	function remove() {
		if (!template || isBuiltinTemplate(template.id)) return;
		templates = templates.filter((t) => t.id !== template.id);
		selectedId = templates[0]?.id ?? '';
	}
</script>

{#if template}
	<div class="space-y-4 p-4">
		<div class="flex flex-wrap gap-2" role="group" aria-label="調整する型">
			{#each templates as item (item.id)}
				<button
					type="button"
					class="btn min-h-10 px-3 py-1 text-sm {item.id === template.id ? 'btn-on' : ''}"
					aria-pressed={item.id === template.id}
					onclick={() => {
						selectedId = item.id;
						frameId = null;
					}}
				>
					{item.name}
				</button>
			{/each}
		</div>

		<!-- プレビュー（枠をドラッグして動かす） -->
		<div bind:this={box} class="relative aspect-video w-full touch-none overflow-hidden border border-zinc-700 select-none">
			<TelopLayer scene={preview} class="absolute inset-0 h-full w-full" />
			{#each template.frames as item (item.id)}
				<div
					role="button"
					tabindex="0"
					aria-label="枠「{item.name}」（ドラッグで移動、矢印キーでも動かせます）"
					class="absolute cursor-move border-2 border-dashed {item.id === frame?.id
						? 'border-sky-400 bg-sky-400/10'
						: 'border-white/40 hover:border-white/80'}"
					style:left={percent(item.x)}
					style:top={percent(item.y)}
					style:width={percent(item.w)}
					style:height={percent(item.h)}
					onpointerdown={(event) => startDrag(event, item, 'move')}
					onkeydown={(event) => nudge(event, item)}
					onfocus={() => (frameId = item.id)}
				>
					<span class="absolute top-0 left-0 bg-black/70 px-1 text-[10px] leading-4 text-white">{item.name}</span>
					<span
						class="absolute right-0 bottom-0 size-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize border-2 border-sky-400 bg-zinc-950"
						aria-hidden="true"
						onpointerdown={(event) => startDrag(event, item, 'resize')}
					></span>
				</div>
			{/each}
		</div>
		<p class="hint">
			枠をドラッグすると動き、右下の角をドラッグすると大きさが変わります（キーボードでは、枠を選んで矢印キー。Shift
			を押しながらで大きさ）。文字は枠に収まるように自動で小さくなります。
		</p>

		{#if frame}
			<fieldset class="space-y-3 border border-zinc-800 p-3">
				<legend class="px-1 text-sm font-semibold text-zinc-200">枠「{frame.name}」</legend>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label class="block text-sm text-zinc-300">
						文字の大きさ（{Math.round(frame.size * 1000) / 10}%）
						<input
							type="range"
							class="mt-1 w-full"
							min="0.02"
							max="0.25"
							step="0.005"
							bind:value={frame.size}
						/>
					</label>
					<div class="flex flex-wrap items-end gap-3 text-sm text-zinc-300">
						<label class="flex items-center gap-2">
							文字の色 <input type="color" bind:value={frame.color} />
						</label>
						<label class="flex items-center gap-2">
							強調の色 <input type="color" bind:value={frame.accent} />
						</label>
					</div>
					<label class="block text-sm text-zinc-300">
						横のそろえ方
						<select class="field mt-1" bind:value={frame.align}>
							<option value="left">左</option>
							<option value="center">中央</option>
							<option value="right">右</option>
						</select>
					</label>
					<label class="block text-sm text-zinc-300">
						縦のそろえ方
						<select class="field mt-1" bind:value={frame.valign}>
							<option value="top">上</option>
							<option value="middle">中央</option>
							<option value="bottom">下</option>
						</select>
					</label>
					<div class="flex flex-wrap items-center gap-4 text-sm text-zinc-300">
						<label class="flex items-center gap-2"><input type="checkbox" bind:checked={frame.bold} /> 太字</label>
						<label class="flex items-center gap-2"><input type="checkbox" bind:checked={frame.outline} /> 黒で縁取る</label>
					</div>
					<div class="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								checked={frame.band !== null}
								onchange={(event) => {
									if (frame) frame.band = event.currentTarget.checked ? '#000000' : null;
								}}
							/>
							帯を敷く
						</label>
						{#if frame.band !== null}
							<input type="color" aria-label="帯の色" bind:value={frame.band} />
							<label class="flex items-center gap-2">
								濃さ
								<input type="range" min="0.1" max="1" step="0.05" bind:value={frame.bandOpacity} />
							</label>
						{/if}
					</div>
				</div>
			</fieldset>
		{/if}

		<div class="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-3 text-sm text-zinc-300">
			<label class="flex items-center gap-2">
				テロップだけを映すときの背景 <input type="color" bind:value={template.background} />
			</label>
			{#if !isBuiltinTemplate(template.id)}
				<label class="flex min-w-48 flex-1 items-center gap-2">
					型の名前 <input class="field min-h-10 py-1" bind:value={template.name} />
				</label>
			{/if}
			<span class="ml-auto flex flex-wrap gap-2">
				<button type="button" class="btn min-h-10 px-3 py-1" onclick={duplicate}>複製して新しい型にする</button>
				{#if isBuiltinTemplate(template.id)}
					<button type="button" class="btn btn-quiet" onclick={reset}>最初の状態に戻す</button>
				{:else}
					<button type="button" class="btn btn-quiet hover:text-red-300" onclick={remove}>この型を削除</button>
				{/if}
			</span>
		</div>
		<p class="hint">
			カメラ映像に重ねたときは背景が透け、文字と帯だけが重なります。調整はこの端末に保存され、いま出している文字にもすぐ反映されます。
		</p>
	</div>
{/if}
