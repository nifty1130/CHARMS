/**
 * 歌詞の台本（Markdown）を読み取る
 *
 * 台本は Markdown で書く。読み取りは、標準（CommonMark）に準拠した部品（micromark）に任せ、
 * GitHub の拡張（表・打ち消し線・チェックボックス・脚注・URL の自動リンク）も読む。
 * 読み取った結果を、テロップの「送る順の一覧」に置き換える。
 *
 * Markdown の書き方と、テロップでの意味:
 *
 * | 書き方 | テロップでの意味 |
 * |---|---|
 * | `# 曲名`（見出し1） | 曲の始まり |
 * | `## 1番`（見出し2〜6） | 区切りの見出し（操作する人の画面だけに出る） |
 * | 段落の1行 | 1回の送り。送るたびに積み重なる |
 * | 空行 | 次の送りで、画面が入れ替わる |
 * | `---`（区切り線） | 1回分の「消す」 |
 * | `> メモ`（引用）、`<!-- メモ -->`（コメント） | 操作する人の画面だけに出るメモ |
 * | `- 項目`（箇条書き・番号付きの箇条書き） | まとめて1回で出す（左上と右下を同時に、など） |
 * | 行末の `\` または空白2つ、`<br>` | 同じ枠の中での改行 |
 * | `**強調**`、`*斜体*`、`~~打ち消し~~`、`` `コード` ``、`[リンク](URL)` | 文字の飾り |
 * | ```` ``` ```` で囲んだコード | そのままの文字として、1回で出す（` ```左上 ` のように枠を指定できる） |
 * | 表 | 1回で出す。1行を1行として出す |
 * | `![説明](画像)` | 画像は出さず、説明の文字を出す |
 * | `[^1]` と `[^1]: 注` （脚注） | 注は、操作する人の画面だけに出る |
 *
 * テロップのための書き足し（Markdown にはない書き方）:
 * - `左上: そうだ`: 行の先頭に枠の名前とコロンを書くと、その枠に出す（書かなければ型の標準の枠）
 * - `型: 歌詞（3か所）`: その曲で使う型（コメントの中に書いてもよい）
 * - `{漢字|かんじ}`: ルビ
 * - 昔の書き方 `SU`（左上）・`SD`（右下）・`F`（中央）・`Clear`（消す）
 */

import type { Blockquote, Code, Html, List, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import {
	DEFAULT_LYRICS_TEMPLATE,
	findFrame,
	findTemplate,
	isBlankText,
	plainText,
	type TelopRun,
	type TelopTemplate,
	type TelopText
} from './telop';

/** 1回の送りで、1つの枠に出す文字 */
export interface ScriptItem {
	/** 枠の ID */
	frame: string;
	text: TelopText;
}

/** 操作する人の画面だけに出るもの */
export interface ScriptNote {
	/** memo: メモ（引用・コメント・脚注） / section: 区切りの見出し */
	kind: 'memo' | 'section';
	text: string;
}

/** 1回の送り */
export type ScriptStep =
	| {
			kind: 'show';
			items: ScriptItem[];
			/** 前の画面を消してから出すか（空行のあと） */
			fresh: boolean;
			/** 台本の何行目か */
			line: number;
			/** この送りの前に書かれていたメモ */
			notes: ScriptNote[];
	  }
	| { kind: 'clear'; line: number; notes: ScriptNote[] };

/** 1曲分 */
export interface ScriptSong {
	title: string;
	template: TelopTemplate;
	steps: ScriptStep[];
	/** 最後の送りのあとに書かれていたメモ */
	notes: ScriptNote[];
	/** 台本の何行目から始まるか */
	line: number;
}

/** 書き方の注意 */
export interface ScriptWarning {
	line: number;
	message: string;
}

/** 台本を読み取った結果 */
export interface Script {
	songs: ScriptSong[];
	warnings: ScriptWarning[];
}

/** 昔の書き方の、行の先頭の記号と枠の名前 */
const LEGACY_FRAMES: Record<string, string> = { SU: '左上', SD: '右下', F: '中央' };

/** 枠の名前として読む、行の先頭の書き方（「左上: 」「中央：」など） */
const FRAME_PREFIX = /^([^\s:：]{1,10})[ \t]*[:：][ \t]*/u;
const LEGACY_PREFIX = /^(SU|SD|F)[ \t　]+/i;
const TEMPLATE_DIRECTIVE = /^型[ \t]*[:：][ \t]*(.+)$/u;
const RUBY = /\{([^{}|]+)\|([^{}]+)\}/g;

function parseTree(source: string): Root {
	return fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

// ---- 文の中の飾り ----

/** 文の中身を読んだもの（文字のまとまり、または改行） */
type Segment = { run: TelopRun } | { soft: true } | { hard: true };

type Style = Omit<TelopRun, 'text' | 'ruby'>;

/** ルビ（{漢字|かんじ}）を読み取って、文字のまとまりにする */
function withRuby(text: string, style: Style): Segment[] {
	const segments: Segment[] = [];
	let last = 0;
	for (const match of text.matchAll(RUBY)) {
		if (match.index > last) segments.push({ run: { ...style, text: text.slice(last, match.index) } });
		segments.push({ run: { ...style, text: match[1], ruby: match[2].replace(/\|/g, '') } });
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({ run: { ...style, text: text.slice(last) } });
	return segments;
}

function phrasing(nodes: PhrasingContent[], style: Style = {}): Segment[] {
	const segments: Segment[] = [];
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				node.value.split('\n').forEach((part, index) => {
					if (index > 0) segments.push({ soft: true });
					if (part) segments.push(...withRuby(part, style));
				});
				break;
			case 'strong':
				segments.push(...phrasing(node.children, { ...style, strong: true }));
				break;
			case 'emphasis':
				segments.push(...phrasing(node.children, { ...style, em: true }));
				break;
			case 'delete':
				segments.push(...phrasing(node.children, { ...style, del: true }));
				break;
			case 'link':
			case 'linkReference':
				segments.push(...phrasing(node.children, { ...style, link: true }));
				break;
			case 'inlineCode':
				segments.push({ run: { ...style, code: true, text: node.value } });
				break;
			case 'break':
				segments.push({ hard: true });
				break;
			case 'image':
			case 'imageReference':
				// 画像は出さず、説明の文字を出す
				if (node.alt) segments.push({ run: { ...style, text: node.alt } });
				break;
			case 'html':
				if (/^<br\s*\/?>$/i.test(node.value.trim())) segments.push({ hard: true });
				// それ以外の HTML のタグとコメントは、文字としては出さない
				break;
			case 'footnoteReference':
				break;
		}
	}
	return segments;
}

/**
 * 文の中身を行に分ける
 *
 * @param softBreaks 段落の中の改行（`soft`）で、送りを分けるか。分けないなら、同じ枠の中の改行にする
 * @returns 送りごとの文字（softBreaks が false なら、1つだけ）。それぞれ、台本の何行目から始まるか付き
 */
function splitSegments(segments: Segment[], softBreaks: boolean): { text: TelopText; offset: number }[] {
	const parts: { text: TelopText; offset: number }[] = [];
	let lines: TelopText = [[]];
	let start = 0;
	let offset = 0;
	const finish = () => {
		parts.push({ text: lines, offset: start });
		lines = [[]];
	};
	for (const segment of segments) {
		if ('run' in segment) {
			lines[lines.length - 1].push(segment.run);
			continue;
		}
		offset += 1;
		if ('soft' in segment && softBreaks) {
			finish();
			start = offset;
		} else {
			lines.push([]);
		}
	}
	finish();
	return parts;
}

/** 行の先頭から、指定した文字数を取り除く */
function dropPrefix(text: TelopText, count: number): TelopText {
	if (count <= 0 || text.length === 0) return text;
	let rest = count;
	const first: TelopRun[] = [];
	for (const run of text[0]) {
		if (rest <= 0) {
			first.push(run);
		} else if (run.text.length <= rest && !run.ruby) {
			rest -= run.text.length;
		} else if (!run.ruby) {
			first.push({ ...run, text: run.text.slice(rest) });
			rest = 0;
		} else {
			first.push(run);
			rest = 0;
		}
	}
	return [first, ...text.slice(1)];
}

/** ブロックの中身を、ひとつながりの文字にする（箇条書きの項目、見出し、メモ用） */
function blockText(nodes: readonly Nodes[]): TelopText {
	const lines: TelopText = [];
	for (const node of nodes) {
		if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
			for (const part of splitSegments(phrasing(node.children), false)) lines.push(...part.text);
		} else if (node.type === 'code') {
			lines.push(...codeText(node));
		} else if (node.type === 'list') {
			for (const item of listItems(node)) lines.push(...item);
		} else if (node.type === 'table') {
			lines.push(...tableText(node));
		} else if (node.type === 'html') {
			const text = stripHtml(node.value);
			if (text) lines.push([{ text }]);
		} else if ('children' in node) {
			lines.push(...blockText(node.children as Nodes[]));
		}
	}
	return lines;
}

function codeText(node: Code): TelopText {
	return node.value.split('\n').map((line) => (line ? [{ text: line, code: true }] : []));
}

function tableText(node: Table): TelopText {
	return node.children.map((row, rowIndex) => {
		const runs: TelopRun[] = [];
		row.children.forEach((cell, index) => {
			if (index > 0) runs.push({ text: '　' });
			for (const line of blockText([cell])) {
				for (const run of line) runs.push(rowIndex === 0 ? { ...run, strong: true } : run);
			}
		});
		return runs;
	});
}

/** 箇条書きの項目ごとの文字（番号やチェックボックスも付ける。入れ子の項目も並べる） */
function listItems(node: List): TelopText[] {
	const items: TelopText[] = [];
	node.children.forEach((item, index) => {
		const nested = item.children.filter((child): child is List => child.type === 'list');
		const text = blockText(item.children.filter((child) => child.type !== 'list'));
		const marks: string[] = [];
		if (node.ordered) marks.push(`${(node.start ?? 1) + index}. `);
		if (item.checked === true) marks.push('☑ ');
		if (item.checked === false) marks.push('☐ ');
		if (marks.length > 0) {
			if (text.length === 0) text.push([]);
			text[0] = [{ text: marks.join('') }, ...text[0]];
		}
		items.push(text);
		for (const list of nested) items.push(...listItems(list));
	});
	return items;
}

function stripHtml(value: string): string {
	return value
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.trim();
}

/** HTML のコメントの中身を取り出す */
function comments(node: Html): string[] {
	return [...node.value.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1].trim()).filter(Boolean);
}

/**
 * フォームに入力した文字（演目名など）を、枠に出す文字にする
 *
 * 台本と同じく Markdown として読み、改行はそのまま枠の中の改行にする。
 */
export function parseField(source: string): TelopText {
	if (!source.trim()) return [];
	return blockText(parseTree(source).children);
}

// ---- 台本 ----

interface Pending {
	/** 枠の名前（書かれていなければ null） */
	frameName: string | null;
	/** 枠の名前を取り除いた文字 */
	text: TelopText;
	/** 枠の名前が型になかったときに出す、元の文字 */
	full: TelopText;
	/** 昔の書き方で枠を指定したか（型になくても、記号は出さない） */
	legacy: boolean;
}

type DraftStep =
	| { kind: 'show'; items: Pending[]; fresh: boolean; line: number; notes: ScriptNote[] }
	| { kind: 'clear'; line: number; notes: ScriptNote[] };

interface DraftSong {
	title: string;
	templateName: string | null;
	templateLine: number;
	steps: DraftStep[];
	notes: ScriptNote[];
	line: number;
}

/** 1行分の文字を読み、枠の指定・型の指定・昔の書き方を取り出す */
function readLine(text: TelopText): { directive: string } | { clear: true } | Pending {
	const plain = (text[0] ?? []).map((run) => (run.ruby ? '\u0000' : run.text)).join('');
	const only = plainText(text);
	const directive = TEMPLATE_DIRECTIVE.exec(only);
	if (directive && text.length === 1) return { directive: directive[1].trim() };
	if (/^clear$/i.test(only)) return { clear: true };

	const legacy = LEGACY_PREFIX.exec(plain);
	if (legacy) {
		return {
			frameName: LEGACY_FRAMES[legacy[1].toUpperCase()],
			text: dropPrefix(text, legacy[0].length),
			full: text,
			legacy: true
		};
	}
	const prefix = FRAME_PREFIX.exec(plain);
	if (prefix && !prefix[1].includes('\u0000')) {
		return { frameName: prefix[1], text: dropPrefix(text, prefix[0].length), full: text, legacy: false };
	}
	return { frameName: null, text, full: text, legacy: false };
}

/**
 * 台本を読み取る
 *
 * @param source 台本（Markdown）
 * @param templates 使える型（`型:` の指定と、枠の名前の読み取りに使う）
 */
export function parseScript(source: string, templates: readonly TelopTemplate[]): Script {
	const lines = source.split(/\r?\n/);
	const tree = parseTree(source);
	const warnings: ScriptWarning[] = [];
	const songs: DraftSong[] = [];
	let song: DraftSong | null = null;
	let notes: ScriptNote[] = [];
	/** 前の送りが終わった行（空行をはさんだかを調べるため） */
	let lastStepEnd = 0;

	const current = (line: number): DraftSong => {
		if (!song) {
			song = { title: '', templateName: null, templateLine: 0, steps: [], notes: [], line };
			songs.push(song);
		}
		return song;
	};
	const blankBetween = (from: number, to: number) => {
		for (let i = from + 1; i < to; i++) if (!lines[i - 1]?.trim()) return true;
		return false;
	};
	const setTemplate = (name: string, line: number) => {
		const target = current(line);
		target.templateName = name;
		target.templateLine = line;
	};
	const addStep = (step: DraftStep, endLine: number) => {
		current(step.line).steps.push(step);
		lastStepEnd = endLine;
	};
	const fresh = (startLine: number) => {
		const target = song as DraftSong | null;
		return !target || target.steps.length === 0 || blankBetween(lastStepEnd, startLine);
	};
	const takeNotes = () => {
		const taken = notes;
		notes = [];
		return taken;
	};
	const note = (kind: ScriptNote['kind'], text: string) => {
		if (text) notes.push({ kind, text });
	};

	/** 段落など、1行ごとに送るもの */
	const addLines = (parts: { text: TelopText; line: number }[], endLine: number) => {
		let first = true;
		for (const { text, line } of parts) {
			if (isBlankText(text)) continue;
			const read = readLine(text);
			if ('directive' in read) {
				setTemplate(read.directive, line);
				continue;
			}
			if ('clear' in read) {
				addStep({ kind: 'clear', line, notes: takeNotes() }, line);
				first = false;
				continue;
			}
			addStep({ kind: 'show', items: [read], fresh: first && fresh(line), line, notes: takeNotes() }, line);
			first = false;
		}
		lastStepEnd = Math.max(lastStepEnd, endLine);
	};

	/** 箇条書きなど、まとめて1回で出すもの */
	const addGroup = (items: Pending[], line: number, endLine: number) => {
		if (items.length === 0) return;
		addStep({ kind: 'show', items, fresh: fresh(line), line, notes: takeNotes() }, endLine);
	};

	const lineOf = (node: RootContent) => node.position?.start.line ?? 1;
	const endOf = (node: RootContent) => node.position?.end.line ?? lineOf(node);

	for (const node of tree.children) {
		const line = lineOf(node);
		const end = endOf(node);
		switch (node.type) {
			case 'heading': {
				const title = plainText(blockText([node]));
				if (end > line && node.depth === 2) {
					warnings.push({
						line,
						message: `「${title}」は、すぐ下の「---」で見出しになり、歌詞として出ません。「---」で消すつもりなら、「---」の上に空行を入れてください。`
					});
				}
				if (node.depth === 1) {
					if (song) (song as DraftSong).notes.push(...takeNotes());
					song = { title, templateName: null, templateLine: 0, steps: [], notes: [], line };
					songs.push(song);
					lastStepEnd = end;
				} else {
					current(line);
					note('section', title);
				}
				break;
			}

			case 'paragraph': {
				const parts = splitSegments(phrasing(node.children), true).map((part) => ({
					text: part.text,
					line: line + part.offset
				}));
				addLines(parts, end);
				break;
			}

			case 'thematicBreak':
				current(line);
				addStep({ kind: 'clear', line, notes: takeNotes() }, end);
				break;

			case 'blockquote':
				current(line);
				checkLazy(node, lines, warnings);
				note('memo', plainText(blockText(node.children), ' '));
				break;

			case 'html': {
				const found = comments(node);
				if (found.length > 0) {
					current(line);
					for (const text of found) {
						const directive = TEMPLATE_DIRECTIVE.exec(text);
						if (directive) setTemplate(directive[1].trim(), line);
						else note('memo', text);
					}
				}
				const rest = stripHtml(node.value);
				if (rest) addLines([{ text: rest.split('\n').map((part) => [{ text: part }]), line }], end);
				break;
			}

			case 'list':
				addGroup(listItems(node).map((text) => readLine(text)).filter(isPending), line, end);
				break;

			case 'code': {
				if (!node.lang && lines[line - 1]?.match(/^( {4}|\t)/)) {
					warnings.push({
						line,
						message: '行の先頭に空白が4つ以上（またはタブが）あるので、Markdown のコード（書いたままの文字）として読みました。'
					});
				}
				const text = codeText(node);
				const frameName = node.lang ? [node.lang, node.meta].filter(Boolean).join(' ') : null;
				addGroup([{ frameName, text, full: text, legacy: false }], line, end);
				break;
			}

			case 'table':
				addGroup([{ frameName: null, text: tableText(node), full: tableText(node), legacy: false }], line, end);
				break;

			case 'footnoteDefinition':
				current(line);
				note('memo', `注 ${node.label ?? node.identifier}: ${plainText(blockText(node.children), ' ')}`);
				break;

			// リンクの参照先の定義（[名前]: URL）は、画面には何も出さない
			case 'definition':
				break;
		}
	}
	if (song) (song as DraftSong).notes.push(...takeNotes());

	return { songs: songs.map((draft) => resolveSong(draft, templates, warnings)), warnings: sortWarnings(warnings) };
}

function isPending(value: ReturnType<typeof readLine>): value is Pending {
	return 'text' in value;
}

/** 引用（>）の続きとして読まれた、「>」のない行を知らせる */
function checkLazy(node: Blockquote, lines: string[], warnings: ScriptWarning[]) {
	const start = node.position?.start.line ?? 0;
	const end = node.position?.end.line ?? 0;
	for (let line = start; line <= end; line++) {
		const text = lines[line - 1] ?? '';
		if (text.trim() && !/^\s{0,3}>/.test(text)) {
			warnings.push({
				line,
				message: `「${text.trim()}」は、前の行の「>」（メモ）の続きとして読まれ、画面に出ません。歌詞なら、メモとの間に空行を入れてください。`
			});
		}
	}
}

function sortWarnings(warnings: ScriptWarning[]): ScriptWarning[] {
	return warnings.sort((a, b) => a.line - b.line);
}

/** 曲の型を決め、枠の名前を枠の ID に置き換える */
function resolveSong(draft: DraftSong, templates: readonly TelopTemplate[], warnings: ScriptWarning[]): ScriptSong {
	const fallback = findTemplate(templates, DEFAULT_LYRICS_TEMPLATE) ?? templates[0];
	let template = fallback;
	if (draft.templateName) {
		const found = findTemplate(templates, draft.templateName);
		if (found) template = found;
		else {
			warnings.push({
				line: draft.templateLine,
				message: `型「${draft.templateName}」が見つからないので、「${fallback.name}」で出します。使える型: ${templates.map((t) => t.name).join('、')}`
			});
		}
	}

	const allFrameNames = new Set(templates.flatMap((t) => t.frames.map((f) => f.name)));
	const steps: ScriptStep[] = draft.steps.map((step) => {
		if (step.kind === 'clear') return step;
		const items: ScriptItem[] = [];
		for (const item of step.items) {
			let frameId = template.defaultFrame;
			let text = item.full;
			if (item.frameName) {
				const f = findFrame(template, item.frameName);
				if (f) {
					frameId = f.id;
					text = item.text;
				} else if (item.legacy) {
					text = item.text;
				} else if (allFrameNames.has(item.frameName)) {
					warnings.push({
						line: step.line,
						message: `型「${template.name}」には「${item.frameName}」の枠がないので、「${template.frames.find((f) => f.id === template.defaultFrame)?.name}」に出します。`
					});
				}
			}
			const same = items.find((other) => other.frame === frameId);
			// 同じ枠に2つ以上あれば、改行でつなげて一緒に出す
			if (same) same.text = [...same.text, ...text];
			else items.push({ frame: frameId, text });
		}
		return { ...step, items };
	});
	return { title: draft.title, template, steps, notes: draft.notes, line: draft.line };
}

/**
 * 何回目の送りまで進めたときの、画面の中身
 *
 * @param index 送りの番号（0 から。-1 なら何も出していない）
 * @returns 枠の ID ごとの文字
 */
export function screenAt(song: ScriptSong, index: number): Record<string, TelopText> {
	let texts: Record<string, TelopText> = {};
	for (let i = 0; i <= index && i < song.steps.length; i++) {
		const step = song.steps[i];
		if (step.kind === 'clear') {
			texts = {};
			continue;
		}
		if (step.fresh) texts = {};
		for (const item of step.items) texts[item.frame] = item.text;
	}
	return texts;
}
