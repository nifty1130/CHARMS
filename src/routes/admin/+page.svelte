<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import TallyBanner from '../../components/TallyBanner.svelte';
	import VideoView from '../../components/VideoView.svelte';
	import {
		CAPTION_FRAME_RATE,
		CAPTION_HEIGHT,
		CAPTION_WIDTH,
		drawCaption,
		splitLyrics,
		type Caption
	} from '$lib/charms/caption';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { tallyFor } from '$lib/charms/routing';
	import { roleOf } from '$lib/roles';
	import { onMount } from 'svelte';

	/** タイムテーブルの1行 */
	interface Entry {
		id: string;
		time: string;
		title: string;
		subtitle: string;
	}

	/** 端末に保存しておく内容（ページを開き直しても残る） */
	interface Saved {
		title: string;
		subtitle: string;
		lyricsTitle: string;
		lyricsText: string;
		entries: Entry[];
	}

	const STORAGE_KEY = 'charms:admin';

	const session = new ClientSession('admin');
	const role = roleOf('admin');
	const tally = $derived(tallyFor(session.id, session.snapshot.routes));

	let tab = $state<'title' | 'lyrics' | 'timetable'>('title');
	/** いま映像として出している内容 */
	let shown = $state<Caption>({ title: '', subtitle: '' });
	let stream = $state.raw<MediaStream | null>(null);

	// タイトル
	let title = $state('');
	let subtitle = $state('');

	// 歌詞
	let lyricsTitle = $state('');
	let lyricsText = $state('');
	let editingLyrics = $state(true);
	/** いま出している歌詞の行（出していないときは -1） */
	let lyricIndex = $state(-1);
	const lyrics = $derived(splitLyrics(lyricsText));

	// タイムテーブル
	let entries = $state<Entry[]>([]);
	/** 最後に出した演目 */
	let currentEntryId = $state<string | null>(null);

	let loaded = false;
	let context: CanvasRenderingContext2D | null = null;

	const isBlank = $derived(!shown.title.trim() && !shown.subtitle.trim());

	onMount(() => {
		// 保存しておいた内容を読み込む
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null;
			if (saved) {
				title = saved.title ?? '';
				subtitle = saved.subtitle ?? '';
				lyricsTitle = saved.lyricsTitle ?? '';
				lyricsText = saved.lyricsText ?? '';
				entries = Array.isArray(saved.entries) ? saved.entries : [];
				editingLyrics = !lyricsText.trim();
			}
		} catch {
			// 壊れた保存データは無視して、空の状態から始める
		}
		loaded = true;

		// 文字を描くキャンバスを用意し、それを映像として送り出す
		const canvas = document.createElement('canvas');
		canvas.width = CAPTION_WIDTH;
		canvas.height = CAPTION_HEIGHT;
		context = canvas.getContext('2d');
		if (context) drawCaption(context, shown);

		const captured = canvas.captureStream(CAPTION_FRAME_RATE);
		captured.getVideoTracks()[0].contentHint = 'detail';
		stream = captured;
		void session.media.setLocalStream(captured);
		session.setStatus({ live: true, sourceKind: 'text' });

		// キャンバスは描き直したときしか新しいコマを出さない。
		// あとからつながった相手にも絵が届くよう、同じ内容を定期的に描き直す。
		const timer = setInterval(() => {
			if (context) drawCaption(context, shown);
		}, 500);

		return () => {
			clearInterval(timer);
			captured.getTracks().forEach((track) => track.stop());
		};
	});

	// 出す内容が変わったら、すぐ描き直す
	$effect(() => {
		const caption = { title: shown.title, subtitle: shown.subtitle };
		if (context) drawCaption(context, caption);
	});

	// 入力した内容を端末に保存する
	$effect(() => {
		const data: Saved = { title, subtitle, lyricsTitle, lyricsText, entries: $state.snapshot(entries) };
		if (!loaded) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// 保存できない環境では、覚えないだけで動作は続ける
		}
	});

	function show(caption: Caption) {
		shown = caption;
	}

	function clear() {
		shown = { title: '', subtitle: '' };
		lyricIndex = -1;
	}

	function showTitle() {
		lyricIndex = -1;
		show({ title, subtitle });
	}

	function showLyric(index: number) {
		if (index < 0 || index >= lyrics.length) return;
		lyricIndex = index;
		show({ title: lyrics[index], subtitle: '' });
		// 出している行が見えるように、一覧をスクロールする
		document.getElementById(`lyric-${index}`)?.scrollIntoView({ block: 'nearest' });
	}

	function showLyricsTitle() {
		lyricIndex = -1;
		show({ title: lyricsTitle, subtitle: '' });
	}

	function addEntry() {
		entries.push({ id: crypto.randomUUID(), time: '', title: '', subtitle: '' });
	}

	function removeEntry(id: string) {
		entries = entries.filter((entry) => entry.id !== id);
	}

	function moveEntry(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= entries.length) return;
		const next = [...entries];
		[next[index], next[target]] = [next[target], next[index]];
		entries = next;
	}

	function showEntry(entry: Entry) {
		lyricIndex = -1;
		currentEntryId = entry.id;
		show({ title: entry.title, subtitle: entry.subtitle });
	}

	function showNextEntry() {
		const index = entries.findIndex((entry) => entry.id === currentEntryId);
		const next = entries[index + 1];
		if (next) showEntry(next);
	}

	/** キーボードで歌詞を送る（↓・スペース: 次の行 / ↑: 前の行 / Esc: 消す） */
	function onKeydown(event: KeyboardEvent) {
		if (!session.connected || tab !== 'lyrics' || editingLyrics) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const element = event.target as HTMLElement | null;
		if (element?.closest('input, textarea, select')) return;

		if (event.key === 'ArrowDown' || event.key === ' ') {
			event.preventDefault();
			showLyric(Math.min(lyricIndex + 1, lyrics.length - 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			showLyric(Math.max(lyricIndex - 1, 0));
		} else if (event.key === 'Escape') {
			clear();
		}
	}
</script>

<svelte:head>
	<title>テロップ — CHARM Point</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<NodeShell {session} {role}>
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
		<!-- いま出している内容 -->
		<div class="space-y-4 lg:col-span-2">
			<section class="panel">
				<TallyBanner {tally} nodes={session.snapshot.nodes} />
				<VideoView {stream} fit="contain" class="aspect-video w-full" />
				<div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
					<span class="text-sm text-zinc-300">
						{isBlank ? 'いまは何も出していません（黒い画面）' : '↑ いま出している内容'}
					</span>
					<button type="button" class="btn" disabled={isBlank} onclick={clear}>文字を消す</button>
				</div>
			</section>

			<section class="panel space-y-3 p-4">
				<p class="hint">
					テロップは「文字のカメラ」です。ここで出した文字は、スイッチャーでこのテロップを選んだモニターに映ります。
				</p>
				<NameEditor
					name={session.name}
					label="このテロップの名前"
					onRename={(name) => session.rename(session.id, name)}
				/>
				{#if session.snapshot.settings.allowRecording}
					<RecordControl
						getStream={() => stream}
						label={session.name}
						description="このテロップの映像を録画します"
						onChange={(recording) => session.setStatus({ recording })}
					/>
				{/if}
			</section>
		</div>

		<!-- 内容を作る -->
		<section class="panel lg:col-span-3">
			<div class="grid grid-cols-3 gap-px border-b border-zinc-800 bg-zinc-800" role="tablist">
				{#each [{ id: 'title', label: 'タイトル' }, { id: 'lyrics', label: '歌詞' }, { id: 'timetable', label: 'タイムテーブル' }] as const as item (item.id)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === item.id}
						class="min-h-12 cursor-pointer px-3 py-2 text-base font-semibold transition-colors {tab === item.id
							? 'bg-zinc-100 text-zinc-950'
							: 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}"
						onclick={() => (tab = item.id)}
					>
						{item.label}
					</button>
				{/each}
			</div>

			{#if tab === 'title'}
				<form
					class="space-y-4 p-4"
					onsubmit={(event) => {
						event.preventDefault();
						showTitle();
					}}
				>
					<label class="block">
						<span class="text-sm text-zinc-300">大きく出す文字（演目名など）</span>
						<textarea class="field mt-1" rows="2" bind:value={title} placeholder="例: 3年A組 合唱"></textarea>
					</label>
					<label class="block">
						<span class="text-sm text-zinc-300">小さく出す文字（出演者や曲名など・なくてもよい）</span>
						<input class="field mt-1" bind:value={subtitle} placeholder="例: 「旅立ちの日に」" />
					</label>
					<button type="submit" class="btn btn-primary" disabled={!title.trim() && !subtitle.trim()}>
						この文字を出す
					</button>
				</form>
			{:else if tab === 'lyrics'}
				<div class="space-y-4 p-4">
					<div class="flex flex-wrap items-end gap-2">
						<label class="min-w-40 flex-1">
							<span class="text-sm text-zinc-300">曲名（なくてもよい）</span>
							<input class="field mt-1" bind:value={lyricsTitle} placeholder="例: 旅立ちの日に" />
						</label>
						<button type="button" class="btn" disabled={!lyricsTitle.trim()} onclick={showLyricsTitle}>
							曲名を出す
						</button>
					</div>

					{#if editingLyrics}
						<label class="block">
							<span class="text-sm text-zinc-300">
								歌詞を貼り付けてください。1行が1画面になります（空の行は「何も出さない」になります）
							</span>
							<textarea
								class="field mt-1 leading-relaxed"
								rows="12"
								bind:value={lyricsText}
								placeholder={'白い光の中に\n山なみは萌えて\n\n遥かな空の果てまでも'}
							></textarea>
						</label>
						<button
							type="button"
							class="btn btn-primary"
							disabled={lyrics.length === 0}
							onclick={() => (editingLyrics = false)}
						>
							歌詞を決定して、送り出しへ進む
						</button>
					{:else}
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="btn btn-primary min-h-14 px-6 text-lg font-bold"
								disabled={lyricIndex >= lyrics.length - 1}
								onclick={() => showLyric(lyricIndex + 1)}
							>
								{lyricIndex < 0 ? '最初の行を出す' : '次の行へ'}
							</button>
							<button type="button" class="btn" disabled={lyricIndex <= 0} onclick={() => showLyric(lyricIndex - 1)}>
								前の行へ
							</button>
							<button type="button" class="btn ml-auto" onclick={() => (editingLyrics = true)}>
								歌詞を編集する
							</button>
						</div>
						<p class="hint">
							キーボードでも送れます（↓ またはスペース: 次の行 / ↑: 前の行 / Esc: 消す）。行を押すと、その行を出します。
						</p>
						<ol class="max-h-96 overflow-y-auto border border-zinc-800">
							{#each lyrics as line, index (index)}
								<li id="lyric-{index}">
									<button
										type="button"
										class="flex w-full cursor-pointer items-baseline gap-3 border-b border-zinc-800 px-3 py-2 text-left text-base transition-colors {index === lyricIndex
											? 'bg-red-600 font-semibold text-white'
											: index === lyricIndex + 1
												? 'bg-emerald-950 text-emerald-100 hover:bg-emerald-900'
												: 'bg-zinc-950 text-zinc-200 hover:bg-zinc-800'}"
										onclick={() => showLyric(index)}
									>
										<span class="w-8 shrink-0 text-right font-mono text-xs opacity-60">{index + 1}</span>
										<span class={line ? '' : 'opacity-50'}>{line || '（何も出さない）'}</span>
									</button>
								</li>
							{/each}
						</ol>
					{/if}
				</div>
			{:else}
				<div class="space-y-3 p-4">
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class="btn btn-primary"
							disabled={entries.length === 0 ||
								entries.findIndex((entry) => entry.id === currentEntryId) >= entries.length - 1}
							onclick={showNextEntry}
						>
							{currentEntryId && entries.some((entry) => entry.id === currentEntryId)
								? '次の演目を出す'
								: '最初の演目を出す'}
						</button>
						<button type="button" class="btn ml-auto" onclick={addEntry}>＋ 演目を追加</button>
					</div>

					{#if entries.length === 0}
						<p class="hint border border-dashed border-zinc-700 p-6 text-center">
							演目を順番に登録しておくと、本番ではボタンひとつでタイトルを出せます。
						</p>
					{:else}
						<ol class="space-y-2">
							{#each entries as entry, index (entry.id)}
								<li
									class="border p-3 {entry.id === currentEntryId
										? 'border-red-500 bg-red-950/30'
										: 'border-zinc-800 bg-zinc-950'}"
								>
									<div class="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr]">
										<input
											class="field min-h-10 py-1 font-mono text-sm"
											bind:value={entry.time}
											placeholder="13:00"
											aria-label="時刻"
										/>
										<input
											class="field min-h-10 py-1"
											bind:value={entry.title}
											placeholder="演目名（大きく出す文字）"
											aria-label="演目名"
										/>
										<input
											class="field min-h-10 py-1 text-sm sm:col-start-2"
											bind:value={entry.subtitle}
											placeholder="出演者など（小さく出す文字）"
											aria-label="出演者など"
										/>
									</div>
									<div class="mt-2 flex flex-wrap items-center gap-2">
										<button
											type="button"
											class="btn min-h-9 px-3 py-1"
											disabled={!entry.title.trim() && !entry.subtitle.trim()}
											onclick={() => showEntry(entry)}
										>
											{entry.id === currentEntryId ? 'もう一度出す' : 'この演目を出す'}
										</button>
										<span class="ml-auto flex">
											<button
												type="button"
												class="btn btn-quiet"
												disabled={index === 0}
												onclick={() => moveEntry(index, -1)}
												aria-label="上へ移動"
											>
												↑
											</button>
											<button
												type="button"
												class="btn btn-quiet"
												disabled={index === entries.length - 1}
												onclick={() => moveEntry(index, 1)}
												aria-label="下へ移動"
											>
												↓
											</button>
											<button
												type="button"
												class="btn btn-quiet hover:text-red-300"
												onclick={() => removeEntry(entry.id)}
											>
												削除
											</button>
										</span>
									</div>
								</li>
							{/each}
						</ol>
						<p class="hint">時刻は進行の目安として、この画面にだけ表示されます（モニターには出ません）。</p>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</NodeShell>
