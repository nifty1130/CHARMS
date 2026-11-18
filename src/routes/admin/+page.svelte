<script lang="ts">
	import LyricsPanel from '../../components/LyricsPanel.svelte';
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import RecordControl from '../../components/RecordControl.svelte';
	import TallyBanner from '../../components/TallyBanner.svelte';
	import TelopLayer from '../../components/TelopLayer.svelte';
	import TemplateEditor from '../../components/TemplateEditor.svelte';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { tallyFor } from '$lib/charms/routing';
	import {
		drawTelop,
		isBlankScene,
		isBlankText,
		mergeTemplates,
		TELOP_FRAME_RATE,
		TELOP_HEIGHT,
		TELOP_WIDTH,
		TITLE_TEMPLATE,
		type TelopScene,
		type TelopTemplate,
		type TelopText
	} from '$lib/charms/telop';
	import { parseField } from '$lib/charms/telop-markdown';
	import { roleOf } from '$lib/roles';
	import { onMount, untrack } from 'svelte';

	/** タイムテーブルの1行 */
	interface Entry {
		id: string;
		time: string;
		title: string;
		subtitle: string;
	}

	/** 端末に保存しておく内容（ページを開き直しても残る） */
	interface Saved {
		script: string;
		/** 「文字を出す」で選んでいる型 */
		fieldTemplate: string;
		/** 「文字を出す」の入力（型の ID → 枠の ID → 文字） */
		fields: Record<string, Record<string, string>>;
		entries: Entry[];
		// 前の版の保存内容（読み込むときに引き継ぐ）
		title?: string;
		subtitle?: string;
		lyricsTitle?: string;
		lyricsText?: string;
	}

	const STORAGE_KEY = 'charms:admin';
	const TEMPLATES_KEY = 'charms:telop-templates:v1';

	const session = new ClientSession('admin');
	/** 録画の操作（スイッチャーからの一斉録画で使う） */
	let recorder: RecordControl | undefined = $state();

	session.onCameraCommand = (command) => {
		if (command.action !== 'record') return;
		if (command.on) recorder?.remoteStart();
		else recorder?.remoteStop();
	};
	const role = roleOf('admin');
	const tally = $derived(tallyFor(session.id, session.snapshot.routes));

	let tab = $state<'text' | 'lyrics' | 'timetable' | 'templates'>('text');
	/** いま出している内容 */
	let scene = $state.raw<TelopScene | null>(null);
	let stream = $state.raw<MediaStream | null>(null);

	/** 型の一覧（調整した内容は端末に保存する） */
	let templates = $state<TelopTemplate[]>(mergeTemplates(null));

	// 文字を出す
	let fieldTemplate = $state(TITLE_TEMPLATE);
	let fields = $state<Record<string, Record<string, string>>>({});
	const fieldTarget = $derived(templates.find((t) => t.id === fieldTemplate) ?? templates[0]);

	// 歌詞
	let script = $state('');

	// タイムテーブル
	let entries = $state<Entry[]>([]);
	/** 最後に出した演目 */
	let currentEntryId = $state<string | null>(null);

	let loaded = $state(false);
	let context: CanvasRenderingContext2D | null = null;

	const isBlank = $derived(isBlankScene(scene));

	onMount(() => {
		// 保存しておいた内容を読み込む
		try {
			templates = mergeTemplates(JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? 'null'));
		} catch {
			// 壊れた保存データは無視して、最初の型から始める
		}
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null;
			if (saved) {
				fields = typeof saved.fields === 'object' && saved.fields ? saved.fields : {};
				if (typeof saved.fieldTemplate === 'string' && templates.some((t) => t.id === saved.fieldTemplate)) {
					fieldTemplate = saved.fieldTemplate;
				}
				entries = Array.isArray(saved.entries) ? saved.entries : [];
				script = typeof saved.script === 'string' ? saved.script : '';
				// 前の版の入力を引き継ぐ
				if (saved.title || saved.subtitle) {
					fields[TITLE_TEMPLATE] ??= { main: saved.title ?? '', sub: saved.subtitle ?? '' };
				}
				if (!script && saved.lyricsText) {
					script = (saved.lyricsTitle ? `# ${saved.lyricsTitle}\n\n` : '') + saved.lyricsText;
				}
			}
		} catch {
			// 壊れた保存データは無視して、空の状態から始める
		}
		loaded = true;

		// 確認用の映像（ホストとスイッチャーの画面に並ぶ小さな映像）を、キャンバスから作る。
		// モニターには映像を送らず、文字のデータを送って、モニターが自分で描く。
		const canvas = document.createElement('canvas');
		canvas.width = TELOP_WIDTH;
		canvas.height = TELOP_HEIGHT;
		context = canvas.getContext('2d');
		paint();

		const captured = canvas.captureStream(TELOP_FRAME_RATE);
		captured.getVideoTracks()[0].contentHint = 'detail';
		stream = captured;
		void session.media.setLocalStream(captured);
		session.setStatus({ live: true, sourceKind: 'text' });

		// キャンバスは描き直したときしか新しいコマを出さない。
		// あとからつながった相手にも絵が届くよう、同じ内容を定期的に描き直す。
		const timer = setInterval(paint, 500);

		return () => {
			clearInterval(timer);
			captured.getTracks().forEach((track) => track.stop());
		};
	});

	function paint() {
		if (context) drawTelop(context, scene, { width: TELOP_WIDTH, height: TELOP_HEIGHT });
	}

	// 入力した内容を端末に保存する
	$effect(() => {
		const data: Saved = {
			script,
			fieldTemplate,
			fields: $state.snapshot(fields),
			entries: $state.snapshot(entries)
		};
		if (!loaded) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// 保存できない環境では、覚えないだけで動作は続ける
		}
	});

	// 型を調整したら保存し、いま出している内容にもすぐ反映する
	$effect(() => {
		const list = $state.snapshot(templates) as TelopTemplate[];
		if (!loaded) return;
		try {
			localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
		} catch {
			// 保存できない環境では、覚えないだけ
		}
		const current = untrack(() => scene);
		if (!current) return;
		const updated = list.find((t) => t.id === current.template.id);
		if (updated && JSON.stringify(updated) !== JSON.stringify(current.template)) {
			show({ template: updated, texts: current.texts });
		}
	});

	/** 内容を出す（モニター・ホスト・スイッチャーに届く） */
	function show(next: TelopScene) {
		scene = next;
		session.setTelop(next);
		paint();
	}

	function clear() {
		if (scene) show({ template: scene.template, texts: {} });
	}

	function templateById(id: string): TelopTemplate {
		const found = templates.find((t) => t.id === id) ?? templates[0];
		return $state.snapshot(found) as TelopTemplate;
	}

	// ---- 文字を出す ----

	function fieldValue(frameId: string): string {
		return fields[fieldTemplate]?.[frameId] ?? '';
	}

	function setField(frameId: string, value: string) {
		fields[fieldTemplate] ??= {};
		fields[fieldTemplate][frameId] = value;
	}

	const fieldsFilled = $derived(fieldTarget.frames.some((f) => fieldValue(f.id).trim()));

	function showFields() {
		const template = templateById(fieldTemplate);
		const texts: Record<string, TelopText> = {};
		for (const f of template.frames) {
			const text = parseField(fieldValue(f.id));
			if (!isBlankText(text)) texts[f.id] = text;
		}
		currentEntryId = null;
		show({ template, texts });
	}

	// ---- 歌詞 ----

	function showTitle(title: string) {
		show({ template: templateById(TITLE_TEMPLATE), texts: { main: parseField(title) } });
	}

	// ---- タイムテーブル ----

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
		currentEntryId = entry.id;
		const texts: Record<string, TelopText> = {};
		const main = parseField(entry.title);
		const sub = parseField(entry.subtitle);
		if (!isBlankText(main)) texts.main = main;
		if (!isBlankText(sub)) texts.sub = sub;
		show({ template: templateById(TITLE_TEMPLATE), texts });
	}

	function showNextEntry() {
		const index = entries.findIndex((entry) => entry.id === currentEntryId);
		const next = entries[index + 1];
		if (next) showEntry(next);
	}

	const TABS = [
		{ id: 'text', label: '文字を出す' },
		{ id: 'lyrics', label: '歌詞' },
		{ id: 'timetable', label: 'タイムテーブル' },
		{ id: 'templates', label: '型の調整' }
	] as const;
</script>

<svelte:head>
	<title>テロップ — CHARM Point</title>
</svelte:head>

<NodeShell {session} {role}>
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
		<!-- いま出している内容 -->
		<div class="space-y-4 lg:col-span-2">
			<section class="panel">
				<TallyBanner {tally} nodes={session.snapshot.nodes} />
				<div class="aspect-video w-full bg-black">
					<TelopLayer {scene} class="h-full w-full" />
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
					<span class="text-sm text-zinc-300">
						{isBlank ? 'いまは何も出していません' : '↑ いま出している内容'}
						{#if scene}<span class="hint">（型: {scene.template.name}）</span>{/if}
					</span>
					<button type="button" class="btn" disabled={isBlank} onclick={clear}>文字を消す</button>
				</div>
			</section>

			<section class="panel space-y-3 p-4">
				<p class="hint">
					テロップは「文字のカメラ」です。ここで出した文字は、スイッチャーでこのテロップを選んだモニターに映ります。「テロップを重ねる」を選ぶと、カメラの映像の上に文字だけが重なります。
				</p>
				<NameEditor
					name={session.name}
					label="このテロップの名前"
					onRename={(name) => session.rename(session.id, name)}
				/>
				{#if session.snapshot.settings.allowRecording}
					<RecordControl
						bind:this={recorder}
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
			<div class="grid grid-cols-2 gap-px border-b border-zinc-800 bg-zinc-800 sm:grid-cols-4" role="tablist">
				{#each TABS as item (item.id)}
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

			{#if tab === 'text'}
				<form
					class="space-y-4 p-4"
					onsubmit={(event) => {
						event.preventDefault();
						showFields();
					}}
				>
					<label class="block">
						<span class="text-sm text-zinc-300">型</span>
						<select class="field mt-1" bind:value={fieldTemplate}>
							{#each templates as item (item.id)}
								<option value={item.id}>{item.name}</option>
							{/each}
						</select>
					</label>
					{#each fieldTarget.frames as f (f.id)}
						<label class="block">
							<span class="text-sm text-zinc-300">{f.name}</span>
							<textarea
								class="field mt-1"
								rows="2"
								value={fieldValue(f.id)}
								oninput={(event) => setField(f.id, event.currentTarget.value)}
							></textarea>
						</label>
					{/each}
					<p class="hint">空の枠は出しません。Markdown の飾り（**強調**、{'{漢字|かんじ}'} のルビ など）も使えます。</p>
					<button type="submit" class="btn btn-primary" disabled={!fieldsFilled}>この文字を出す</button>
				</form>
			{:else if tab === 'lyrics'}
				<LyricsPanel
					bind:script
					{templates}
					active={session.connected}
					onShow={show}
					onShowTitle={showTitle}
					onClear={clear}
				/>
			{:else if tab === 'timetable'}
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
							演目を順番に登録しておくと、本番ではボタンひとつで「演目タイトル」の型で出せます。
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
			{:else}
				<TemplateEditor bind:templates {scene} />
			{/if}
		</section>
	</div>
</NodeShell>
