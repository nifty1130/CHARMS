<script lang="ts">
	import { plainText, type TelopScene, type TelopTemplate } from '$lib/charms/telop';
	import { parseScript, screenAt, type ScriptStep } from '$lib/charms/telop-markdown';

	/**
	 * 歌詞の台本を書き、1回ずつ送る
	 *
	 * 台本は Markdown で書く（メモ帳で作ったファイルを読み込んでもよい）。決定すると、
	 * 曲ごとの「送る順の一覧」になり、ボタンやキーボードで1回ずつ送る。
	 */
	interface Props {
		/** 台本（ここで書き換える） */
		script: string;
		templates: TelopTemplate[];
		/** 送れる状態か（ホストとつながっているか） */
		active: boolean;
		/** 画面に出す */
		onShow: (scene: TelopScene) => void;
		/** 曲名を出す */
		onShowTitle: (title: string) => void;
		/** 文字を消す */
		onClear: () => void;
	}

	let { script = $bindable(), templates, active, onShow, onShowTitle, onClear }: Props = $props();

	let editing = $state(!script.trim());
	let songIndex = $state(0);
	/** いま出している送りの番号（出していないときは -1） */
	let stepIndex = $state(-1);
	let fileInput: HTMLInputElement | undefined = $state();
	let loadError = $state<string | null>(null);

	const parsed = $derived(parseScript(script, templates));
	const song = $derived(parsed.songs[Math.min(songIndex, parsed.songs.length - 1)] ?? null);
	const totalSteps = $derived(parsed.songs.reduce((sum, s) => sum + s.steps.length, 0));
	const nextStep = $derived(song?.steps[stepIndex + 1] ?? null);

	function frameName(frameId: string): string {
		return song?.template.frames.find((f) => f.id === frameId)?.name ?? frameId;
	}

	function describe(step: ScriptStep): string {
		if (step.kind === 'clear') return '（消す）';
		return step.items.map((item) => plainText(item.text, ' / ')).join('　＋　');
	}

	function go(index: number) {
		if (!song || index < 0 || index >= song.steps.length) return;
		stepIndex = index;
		onShow({ template: $state.snapshot(song.template) as TelopTemplate, texts: screenAt(song, index) });
		document.getElementById(`step-${index}`)?.scrollIntoView({ block: 'nearest' });
	}

	function chooseSong(index: number) {
		songIndex = index;
		stepIndex = -1;
	}

	function clear() {
		stepIndex = -1;
		onClear();
	}

	/** キーボードで送る（↓・スペース: 次 / ↑: 前 / Esc: 消す） */
	function onKeydown(event: KeyboardEvent) {
		if (!active || editing || !song) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const element = event.target as HTMLElement | null;
		if (element?.closest('input, textarea, select, [contenteditable]')) return;
		if (event.key === 'ArrowDown' || event.key === ' ') {
			event.preventDefault();
			go(Math.min(stepIndex + 1, song.steps.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			go(Math.max(stepIndex - 1, 0));
		} else if (event.key === 'Escape') {
			clear();
		}
	}

	/** ファイルを読み込む（UTF-8 で読めなければ、古いメモ帳の Shift_JIS として読む） */
	async function load(file: File) {
		loadError = null;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let text: string;
			try {
				text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			} catch {
				text = new TextDecoder('shift_jis').decode(bytes);
			}
			script = text.replace(/^﻿/, '');
			songIndex = 0;
			stepIndex = -1;
		} catch {
			loadError = 'ファイルを読み込めませんでした。';
		}
	}

	function save() {
		const blob = new Blob([script], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${parsed.songs[0]?.title || '歌詞'}.md`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="space-y-4 p-4">
	{#if editing}
		<div class="flex flex-wrap items-center gap-2">
			<button type="button" class="btn min-h-10 px-3 py-1" onclick={() => fileInput?.click()}>ファイルを読み込む</button>
			<button type="button" class="btn min-h-10 px-3 py-1" disabled={!script.trim()} onclick={save}>
				ファイルに書き出す
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".md,.markdown,.txt,text/plain,text/markdown"
				class="hidden"
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) void load(file);
					event.currentTarget.value = '';
				}}
			/>
			<span class="hint">メモ帳で作った .md / .txt ファイルを読み込めます</span>
		</div>
		{#if loadError}<p class="text-sm text-red-300" role="alert">{loadError}</p>{/if}

		<label class="block">
			<span class="text-sm text-zinc-300">歌詞の台本（Markdown で書きます。1行が1回の送りです）</span>
			<textarea
				class="field mt-1 font-mono text-sm leading-relaxed"
				rows="14"
				bind:value={script}
				spellcheck="false"
				placeholder={'# 曲名\n型: 歌詞（3か所）\n> 前奏なし。いきなり歌い出し\n\n左上: そうだ\n右下: うれしいんだ\n中央: 生きるよろこび\n\n左上: 愛と\n\n---'}
			></textarea>
		</label>

		<details class="border border-zinc-800 bg-zinc-950 p-3 text-sm">
			<summary class="cursor-pointer text-zinc-200">書き方</summary>
			<table class="mt-2 w-full text-left text-xs leading-relaxed text-zinc-300">
				<tbody>
					{#each [
						['# 曲名', '曲の始まり（1つの台本に何曲でも書けます）'],
						['## 1番', '区切りの見出し（この画面だけに出ます）'],
						['型: 歌詞（3か所）', 'その曲で使う型。' + templates.map((t) => t.name).join('、')],
						['左上: そうだ', '行の先頭に枠の名前とコロン。書かなければ型の標準の枠'],
						['1行', '1回の送り。送るたびに積み重なります（同じ枠なら入れ替わる）'],
						['空行', '次の送りで、画面が入れ替わります'],
						['---', '1回分の「消す」。歌詞のすぐ下に書くと見出しになるので、上に空行を入れます'],
						['> メモ / <!-- メモ -->', 'この画面だけに出るメモ。「>」のすぐ次の行もメモの続きになります'],
						['- 左上: 愛と\n- 右下: 勇気だけが', '箇条書きは、まとめて1回で出します'],
						['行末の \\ / <br>', '同じ枠の中での改行'],
						['**強調** *斜体* ~~消し~~ `コード`', '文字の飾り（強調は型の強調色）'],
						['{漢字|かんじ}', 'ルビ'],
						['SU / SD / F / Clear', '昔の書き方（左上 / 右下 / 中央 / 消す）もそのまま使えます']
					] as [syntax, meaning] (syntax)}
						<tr class="border-t border-zinc-800 align-top">
							<td class="py-1 pr-3 font-mono whitespace-pre text-zinc-100">{syntax}</td>
							<td class="py-1">{meaning}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="hint mt-2">
				ほかの Markdown の書き方（番号付きの箇条書き、チェックボックス、表、コード、リンク、画像の説明文、脚注）も読めます。
			</p>
		</details>

		{#if parsed.warnings.length > 0}
			<div class="border border-amber-500/50 bg-amber-500/10 p-3" role="status" aria-label="書き方の注意">
				<p class="text-sm font-semibold text-amber-100">書き方の注意（{parsed.warnings.length}件）</p>
				<ul class="mt-1 space-y-1 text-sm text-amber-100">
					{#each parsed.warnings as warning, index (index)}
						<li><span class="font-mono text-xs opacity-70">{warning.line}行目</span>　{warning.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="btn btn-primary"
				disabled={totalSteps === 0}
				onclick={() => {
					editing = false;
					chooseSong(Math.min(songIndex, Math.max(0, parsed.songs.length - 1)));
				}}
			>
				台本を決定して、送り出しへ進む
			</button>
			<span class="hint">{parsed.songs.length}曲・送り {totalSteps}回</span>
		</div>
	{:else if song}
		{#if parsed.songs.length > 1}
			<div class="flex flex-wrap gap-2" role="group" aria-label="曲">
				{#each parsed.songs as item, index (index)}
					<button
						type="button"
						class="btn min-h-10 px-3 py-1 text-sm {index === songIndex ? 'btn-on' : ''}"
						aria-pressed={index === songIndex}
						onclick={() => chooseSong(index)}
					>
						{item.title || `曲 ${index + 1}`}
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
			<span class="font-semibold text-zinc-100">{song.title || '（曲名なし）'}</span>
			<span>型: {song.template.name}</span>
			<span class="ml-auto flex gap-2">
				<button type="button" class="btn min-h-9 px-3 py-1" disabled={!song.title} onclick={() => onShowTitle(song.title)}>
					曲名を出す
				</button>
				<button type="button" class="btn min-h-9 px-3 py-1" onclick={() => (editing = true)}>台本を編集する</button>
			</span>
		</div>

		<!-- 送りの操作（スマホでは画面の下に固定） -->
		<div class="sticky bottom-0 z-10 -mx-4 space-y-2 border-y border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
			{#if nextStep && nextStep.notes.length > 0}
				<div class="space-y-0.5 text-sm text-amber-200" aria-label="次の送りのメモ">
					{#each nextStep.notes as note, index (index)}
						<p class={note.kind === 'section' ? 'font-semibold' : ''}>{note.kind === 'section' ? '■ ' : '※ '}{note.text}</p>
					{/each}
				</div>
			{/if}
			<div class="flex flex-wrap items-stretch gap-2">
				<button
					type="button"
					class="btn btn-primary min-h-16 min-w-0 flex-1 px-4 text-left"
					disabled={!nextStep}
					onclick={() => go(stepIndex + 1)}
				>
					<span class="block text-lg font-bold">{stepIndex < 0 ? '最初を出す' : '次へ'}</span>
					<span class="block truncate text-sm font-normal opacity-80">
						{nextStep ? describe(nextStep) : 'この曲の最後です'}
					</span>
				</button>
				<button type="button" class="btn min-h-16 px-4" disabled={stepIndex <= 0} onclick={() => go(stepIndex - 1)}>
					戻る
				</button>
				<button type="button" class="btn min-h-16 px-4" onclick={clear}>消す</button>
			</div>
			<p class="hint text-xs">キーボード: ↓ またはスペースで次へ / ↑ で戻る / Esc で消す。一覧の行を押すと、そこから出します。</p>
		</div>

		<ol class="max-h-[28rem] overflow-y-auto border border-zinc-800" aria-label="送る順の一覧">
			{#each song.steps as step, index (index)}
				{#each step.notes as note, noteIndex (noteIndex)}
					<li class="border-b border-zinc-800 bg-amber-500/5 px-3 py-1 text-sm {note.kind === 'section' ? 'font-semibold text-amber-100' : 'text-amber-200'}">
						{note.kind === 'section' ? '■ ' : '※ '}{note.text}
					</li>
				{/each}
				<li id="step-{index}" class={step.kind === 'show' && step.fresh && index > 0 ? 'border-t-4 border-zinc-700' : ''}>
					<button
						type="button"
						class="flex w-full cursor-pointer items-baseline gap-3 border-b border-zinc-800 px-3 py-2 text-left text-base transition-colors {index === stepIndex
							? 'bg-red-600 font-semibold text-white'
							: index === stepIndex + 1
								? 'bg-emerald-950 text-emerald-100 hover:bg-emerald-900'
								: 'bg-zinc-950 text-zinc-200 hover:bg-zinc-800'}"
						aria-current={index === stepIndex ? 'step' : undefined}
						onclick={() => go(index)}
					>
						<span class="w-8 shrink-0 text-right font-mono text-xs opacity-60">{index + 1}</span>
						{#if step.kind === 'clear'}
							<span class="opacity-60">（消す）</span>
						{:else}
							<span class="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
								{#each step.items as item, itemIndex (itemIndex)}
									<span>
										<span class="mr-1 border border-current px-1 text-[10px] opacity-70">{frameName(item.frame)}</span>{plainText(item.text, ' / ')}
									</span>
								{/each}
							</span>
						{/if}
					</button>
				</li>
			{/each}
			{#each song.notes as note, noteIndex (noteIndex)}
				<li class="bg-amber-500/5 px-3 py-1 text-sm text-amber-200">{note.kind === 'section' ? '■ ' : '※ '}{note.text}</li>
			{/each}
		</ol>
		<p class="hint">太い線は、そこで画面が入れ替わる区切り（台本の空行）です。</p>
	{/if}
</div>
