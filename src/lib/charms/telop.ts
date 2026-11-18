/**
 * テロップ（文字の表示）
 *
 * テロップ端末は、文字を映像にせず、「どの型の、どの枠に、どの文字を出すか」をデータ（場面）で送る。
 * 各モニターが、それを自分で描く。こうすると、カメラ映像に重ねたときに背景がきれいに透け、
 * 色の付いた文字や半透明の帯も崩れず、文字も映像の圧縮でにじまない。
 *
 * - 型（テンプレート）: 枠の並べ方と見た目の組み合わせ。「歌詞（3か所）」「名前の帯」など
 * - 枠: 文字を出す場所。名前（「左上」など）が付いていて、歌詞の書き方でもこの名前を使う
 * - 場面: いま出している型と、枠ごとの文字
 *
 * 枠の文字は、Markdown を読み取った結果（強調・斜体・打ち消し線・コード・リンク・ルビの付いた
 * 文字のまとまりを、行ごとに並べたもの）で持つ。読み取りは telop-markdown.ts で行う。
 */

/** 横のそろえ方 */
export type TelopAlign = 'left' | 'center' | 'right';
/** 縦のそろえ方 */
export type TelopVAlign = 'top' | 'middle' | 'bottom';

/** 文字を出す枠 */
export interface TelopFrame {
	/** 型の中で枠を区別する ID（変えない） */
	id: string;
	/** 枠の名前（歌詞の書き方で「左上: そうだ」のように使う） */
	name: string;
	/** 画面の中での位置と大きさ（画面の幅・高さに対する割合。0〜1） */
	x: number;
	y: number;
	w: number;
	h: number;
	align: TelopAlign;
	valign: TelopVAlign;
	/** 文字の大きさ（画面の高さに対する割合）。枠に収まらないときは自動で小さくする */
	size: number;
	/** 太字にするか */
	bold: boolean;
	/** 文字の色 */
	color: string;
	/** 強調（`**…**`）の色 */
	accent: string;
	/** 文字を黒で縁取るか（明るい映像に重ねても読めるようにする） */
	outline: boolean;
	/** 枠に敷く帯の色（帯なしは null） */
	band: string | null;
	/** 帯の濃さ（0〜1） */
	bandOpacity: number;
}

/** 型（テンプレート） */
export interface TelopTemplate {
	id: string;
	name: string;
	/** テロップだけを映すときの背景色（カメラ映像に重ねるときは透ける） */
	background: string;
	frames: TelopFrame[];
	/** 枠の名前を書かなかった行を出す枠の ID */
	defaultFrame: string;
}

/** 同じ見た目で続く文字のまとまり */
export interface TelopRun {
	text: string;
	/** 強調（`**…**`）。型の強調色・太字で出す */
	strong?: boolean;
	/** 斜体（`*…*`） */
	em?: boolean;
	/** 打ち消し線（`~~…~~`） */
	del?: boolean;
	/** コード（`` `…` ``）。等幅の文字で出す */
	code?: boolean;
	/** リンク（`[…](…)`）。下線を引く */
	link?: boolean;
	/** ルビ（ふりがな）。あれば text の上に小さく出す */
	ruby?: string;
}

/** 枠に出す文字（行ごとの、文字のまとまりの並び） */
export type TelopText = TelopRun[][];

/** 場面（いま出している内容） */
export interface TelopScene {
	template: TelopTemplate;
	/** 枠の ID ごとの文字（出していない枠は、なし） */
	texts: Record<string, TelopText>;
}

/** テロップ端末が送る確認用の映像の大きさ（16:9） */
export const TELOP_WIDTH = 1280;
export const TELOP_HEIGHT = 720;
/** 確認用の映像のコマ数（文字は動かないので少なくてよい） */
export const TELOP_FRAME_RATE = 15;

/** 1つの枠に入れられる文字数 */
export const MAX_TELOP_TEXT = 400;
/** 1つの枠に入れられる行数 */
export const MAX_TELOP_LINES = 24;
/** 1つの型に置ける枠の数 */
export const MAX_TELOP_FRAMES = 8;

const FONT_FAMILY =
	"'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Noto Sans JP', Meiryo, sans-serif";
const MONO_FAMILY = "'BIZ UDGothic', 'Osaka-Mono', Consolas, 'Courier New', monospace";

// ---- 最初から入っている型 ----

function frame(
	id: string,
	name: string,
	[x, y, w, h]: [number, number, number, number],
	options: Partial<TelopFrame> = {}
): TelopFrame {
	return {
		id,
		name,
		x,
		y,
		w,
		h,
		align: 'center',
		valign: 'middle',
		size: 0.08,
		bold: true,
		color: '#ffffff',
		accent: '#facc15',
		outline: true,
		band: null,
		bandOpacity: 0.6,
		...options
	};
}

/**
 * 最初から入っている型
 *
 * 型を増やすときは、ここに足す（ID は変えない。端末に保存された調整と結び付けるため）。
 */
export const BUILTIN_TEMPLATES: readonly TelopTemplate[] = [
	{
		id: 'lyrics3',
		name: '歌詞（3か所）',
		background: '#000000',
		defaultFrame: 'center',
		frames: [
			frame('tl', '左上', [0.04, 0.05, 0.62, 0.27], { align: 'left', valign: 'top', size: 0.085 }),
			frame('center', '中央', [0.05, 0.3, 0.9, 0.4], { size: 0.12 }),
			frame('br', '右下', [0.34, 0.68, 0.62, 0.27], { align: 'right', valign: 'bottom', size: 0.085 })
		]
	},
	{
		id: 'lyrics-bottom',
		name: '歌詞（下に1〜2行）',
		background: '#000000',
		defaultFrame: 'main',
		frames: [
			frame('main', '歌詞', [0, 0.76, 1, 0.2], {
				size: 0.065,
				outline: false,
				band: '#000000',
				bandOpacity: 0.6
			})
		]
	},
	{
		id: 'title',
		name: '演目タイトル',
		background: '#000000',
		defaultFrame: 'main',
		frames: [
			frame('main', '演目名', [0.06, 0.2, 0.88, 0.38], { valign: 'bottom', size: 0.11 }),
			frame('sub', '出演者', [0.06, 0.62, 0.88, 0.18], {
				valign: 'top',
				size: 0.055,
				bold: false,
				color: '#d4d4d8'
			})
		]
	},
	{
		id: 'nameplate',
		name: '名前の帯',
		background: '#000000',
		defaultFrame: 'name',
		frames: [
			frame('role', '肩書き', [0.05, 0.7, 0.42, 0.075], {
				align: 'left',
				size: 0.038,
				bold: false,
				outline: false,
				band: '#1d4ed8',
				bandOpacity: 0.92
			}),
			frame('name', '名前', [0.05, 0.775, 0.42, 0.12], {
				align: 'left',
				size: 0.065,
				outline: false,
				band: '#000000',
				bandOpacity: 0.78
			})
		]
	}
];

/** 歌詞で型を指定しなかったときの型 */
export const DEFAULT_LYRICS_TEMPLATE = 'lyrics3';
/** 演目名・タイムテーブルで使う型 */
export const TITLE_TEMPLATE = 'title';

/** 型の複製（調整しても、元の型を書き換えないように） */
export function cloneTemplate(template: TelopTemplate): TelopTemplate {
	return { ...template, frames: template.frames.map((f) => ({ ...f })) };
}

/** 文字が何もない（何も出さない）か */
export function isBlankText(text: TelopText | undefined): boolean {
	return !text || text.every((line) => line.every((run) => !run.text.trim() && !run.ruby?.trim()));
}

/** 枠の中身がない（何も出していない）場面か */
export function isBlankScene(scene: TelopScene | null): boolean {
	return !scene || Object.values(scene.texts).every(isBlankText);
}

/** 飾りを取り除いた文字だけにする（一覧の表示用。行は空白でつなぐ） */
export function plainText(text: TelopText | undefined, separator = ' '): string {
	if (!text) return '';
	return text
		.map((line) => line.map((run) => run.text).join(''))
		.join(separator)
		.trim();
}

/** 飾りのない文字列から、枠に出す文字を作る（改行で行を分ける） */
export function textOf(value: string): TelopText {
	return value.split(/\r?\n/).map((line) => (line ? [{ text: line }] : []));
}

/** 名前の表記ゆれ（全角・半角、空白、波ダッシュ）をならす */
function normalizeName(name: string): string {
	return name.normalize('NFKC').replace(/[\s　]/g, '').replace(/[〜～]/g, '~').toLowerCase();
}

/**
 * 型を名前（または ID）で探す
 *
 * 全角・半角や空白の違いは気にしない。完全に一致するものがなければ、名前の一部が一致する
 * 型が1つだけのときに、それを選ぶ（「歌詞3」で「歌詞（3か所）」など）。
 */
export function findTemplate(templates: readonly TelopTemplate[], query: string): TelopTemplate | null {
	const wanted = normalizeName(query);
	if (!wanted) return null;
	const exact = templates.find((t) => normalizeName(t.name) === wanted || t.id === query.trim());
	if (exact) return exact;
	const loose = (value: string) => value.replace(/[()（）か所]/g, '');
	const partial = templates.filter(
		(t) => normalizeName(t.name).includes(wanted) || loose(normalizeName(t.name)) === loose(wanted)
	);
	return partial.length === 1 ? partial[0] : null;
}

/** 型の中から、枠を名前で探す */
export function findFrame(template: TelopTemplate, name: string): TelopFrame | null {
	const wanted = normalizeName(name);
	return template.frames.find((f) => normalizeName(f.name) === wanted) ?? null;
}

// ---- 届いたデータの確かめ ----

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const color = (value: unknown, fallback: string): string =>
	typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback;
const shortText = (value: unknown, max: number): string | null =>
	typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

/** 届いた枠のデータを確かめ、おかしな値は直す（読めなければ null） */
function sanitizeFrame(value: unknown): TelopFrame | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;
	const id = shortText(v.id, 40);
	const name = shortText(v.name, 20);
	if (!id || !name) return null;
	const x = clamp(v.x, 0, 0.98, 0);
	const y = clamp(v.y, 0, 0.98, 0);
	return {
		id,
		name,
		x,
		y,
		w: clamp(v.w, 0.02, 1 - x, 0.5),
		h: clamp(v.h, 0.02, 1 - y, 0.2),
		align: v.align === 'left' || v.align === 'right' ? v.align : 'center',
		valign: v.valign === 'top' || v.valign === 'bottom' ? v.valign : 'middle',
		size: clamp(v.size, 0.01, 0.4, 0.08),
		bold: v.bold !== false,
		color: color(v.color, '#ffffff'),
		accent: color(v.accent, '#facc15'),
		outline: v.outline === true,
		band: v.band === null || v.band === undefined ? null : color(v.band, '#000000'),
		bandOpacity: clamp(v.bandOpacity, 0, 1, 0.6)
	};
}

/** 届いた型のデータを確かめる（読めなければ null） */
export function sanitizeTemplate(value: unknown): TelopTemplate | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;
	const id = shortText(v.id, 40);
	const name = shortText(v.name, 40);
	if (!id || !name || !Array.isArray(v.frames)) return null;
	const frames: TelopFrame[] = [];
	for (const item of v.frames.slice(0, MAX_TELOP_FRAMES)) {
		const f = sanitizeFrame(item);
		if (f && !frames.some((other) => other.id === f.id)) frames.push(f);
	}
	if (frames.length === 0) return null;
	const defaultFrame =
		typeof v.defaultFrame === 'string' && frames.some((f) => f.id === v.defaultFrame)
			? v.defaultFrame
			: frames[0].id;
	return { id, name, background: color(v.background, '#000000'), frames, defaultFrame };
}

/** 届いた文字のデータを確かめる（多すぎる分は切り捨てる） */
export function sanitizeText(value: unknown): TelopText {
	if (!Array.isArray(value)) return [];
	let budget = MAX_TELOP_TEXT;
	const lines: TelopText = [];
	for (const line of value.slice(0, MAX_TELOP_LINES)) {
		if (!Array.isArray(line)) continue;
		const runs: TelopRun[] = [];
		for (const item of line) {
			if (budget <= 0) break;
			if (typeof item !== 'object' || item === null) continue;
			const v = item as Record<string, unknown>;
			if (typeof v.text !== 'string') continue;
			const text = v.text.slice(0, budget);
			budget -= text.length;
			const run: TelopRun = { text };
			if (v.strong === true) run.strong = true;
			if (v.em === true) run.em = true;
			if (v.del === true) run.del = true;
			if (v.code === true) run.code = true;
			if (v.link === true) run.link = true;
			if (typeof v.ruby === 'string' && v.ruby) run.ruby = v.ruby.slice(0, 60);
			runs.push(run);
		}
		lines.push(runs);
	}
	return lines;
}

/**
 * 届いた場面のデータを確かめる（ホストとモニターで使う）
 *
 * @returns 確かめた場面。読めなければ null（何も出さない）
 */
export function sanitizeScene(value: unknown): TelopScene | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;
	const template = sanitizeTemplate(v.template);
	if (!template) return null;
	const texts: Record<string, TelopText> = {};
	const source = typeof v.texts === 'object' && v.texts !== null ? (v.texts as Record<string, unknown>) : {};
	for (const f of template.frames) {
		const text = sanitizeText(source[f.id]);
		if (!isBlankText(text)) texts[f.id] = text;
	}
	return { template, texts };
}

/**
 * 端末に保存しておいた型の一覧を読み込む
 *
 * 最初から入っている型は、調整して保存したものがあればそれを使う。自分で増やした型は後ろに並べる。
 */
export function mergeTemplates(saved: unknown): TelopTemplate[] {
	const list = Array.isArray(saved) ? saved.map(sanitizeTemplate).filter((t) => t !== null) : [];
	const result = BUILTIN_TEMPLATES.map((builtin) => {
		const custom = list.find((t) => t.id === builtin.id);
		return custom ?? cloneTemplate(builtin);
	});
	for (const t of list) {
		if (!result.some((other) => other.id === t.id)) result.push(t);
	}
	return result;
}

/** 最初から入っている型か */
export function isBuiltinTemplate(id: string): boolean {
	return BUILTIN_TEMPLATES.some((t) => t.id === id);
}

// ---- 折り返し ----

/** 行の先頭に来ると読みにくい文字（前の行の末尾に残す） */
const NO_LINE_START = new Set('、。，．,.！？!?）」』】〕〉》ー～…・ゃゅょっャュョッ');

/** 折り返しの単位（日本語は1文字、英単語や数字はひとかたまり） */
interface Piece extends TelopRun {
	space: boolean;
}

/** 折り返した1行 */
export interface TelopLine {
	pieces: TelopRun[];
	/** ルビのある行か（行の高さを増やす） */
	ruby: boolean;
}

function splitPieces(runs: TelopRun[]): Piece[] {
	const pieces: Piece[] = [];
	for (const run of runs) {
		if (run.ruby) {
			// ルビを付けた語は、途中で折り返さない
			pieces.push({ ...run, space: false });
			continue;
		}
		for (const token of run.text.match(/[!-~]+|\s+|./gu) ?? []) {
			pieces.push({ ...run, text: token, space: /^\s+$/.test(token) });
		}
	}
	return pieces;
}

const sameStyle = (a: TelopRun, b: TelopRun) =>
	!!a.strong === !!b.strong && !!a.em === !!b.em && !!a.del === !!b.del && !!a.code === !!b.code && !!a.link === !!b.link;

/** 同じ見た目で続くまとまりをつなげる（描く回数を減らす） */
function merge(pieces: Piece[]): TelopRun[] {
	const runs: TelopRun[] = [];
	for (const { space: _space, ...piece } of pieces) {
		const last = runs[runs.length - 1];
		if (last && !last.ruby && !piece.ruby && sameStyle(last, piece)) last.text += piece.text;
		else runs.push({ ...piece });
	}
	return runs;
}

/**
 * 飾り付きの文字を、指定した幅に収まるように折り返す
 *
 * @param measure 文字のまとまりの幅を測る関数（ルビがあれば、ルビも含めた幅）
 */
export function layoutLines(
	lines: TelopText,
	maxWidth: number,
	measure: (run: TelopRun) => number
): TelopLine[] {
	const result: TelopLine[] = [];
	const width = (pieces: TelopRun[]) => pieces.reduce((sum, piece) => sum + measure(piece), 0);

	for (const runs of lines) {
		let line: Piece[] = [];
		const push = () => {
			while (line.length > 0 && line[line.length - 1].space) line.pop();
			result.push({ pieces: merge(line), ruby: line.some((piece) => !!piece.ruby) });
			line = [];
		};
		for (const piece of splitPieces(runs)) {
			if (line.length === 0 && piece.space) continue; // 行頭の空白は捨てる
			if (line.length === 0 || width([...line, piece]) <= maxWidth || NO_LINE_START.has(piece.text)) {
				line.push(piece);
			} else {
				push();
				if (!piece.space) line.push(piece);
			}
		}
		push();
	}

	// 前後の空行は取り除く（途中の空行は、意図した行間として残す）
	const empty = (line: TelopLine) => line.pieces.length === 0;
	while (result.length > 0 && empty(result[0])) result.shift();
	while (result.length > 0 && empty(result[result.length - 1])) result.pop();
	return result;
}

/**
 * 飾りのない文字を折り返す（行ごとの文字列を返す）
 *
 * @param measure 文字列の幅を測る関数
 */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
	return layoutLines(textOf(text), maxWidth, (run) => measure(run.text)).map((line) =>
		line.pieces.map((run) => run.text).join('')
	);
}

// ---- 描画 ----

/** ルビの大きさ（本文の文字に対する割合） */
const RUBY_SCALE = 0.5;

interface Block {
	lines: TelopLine[];
	size: number;
	height: number;
}

function lineHeight(line: TelopLine, size: number): number {
	return size * 1.25 + (line.ruby ? size * RUBY_SCALE : 0);
}

/**
 * 場面を描く
 *
 * @param context 描く先のキャンバス
 * @param scene 出す内容（null なら、背景だけ）
 * @param options.transparent 背景を塗らずに透かす（カメラ映像に重ねるとき）
 */
export function drawTelop(
	context: CanvasRenderingContext2D,
	scene: TelopScene | null,
	{ width, height, transparent = false }: { width: number; height: number; transparent?: boolean }
): void {
	context.save();
	context.clearRect(0, 0, width, height);
	if (!transparent) {
		context.fillStyle = scene?.template.background ?? '#000000';
		context.fillRect(0, 0, width, height);
	}
	if (scene) {
		for (const f of scene.template.frames) {
			const text = scene.texts[f.id];
			if (!isBlankText(text)) drawFrame(context, f, text, width, height);
		}
	}
	context.restore();
}

function fontOf(f: TelopFrame, run: TelopRun, size: number): string {
	const weight = run.strong ? 800 : f.bold ? 700 : 400;
	const style = run.em ? 'italic ' : '';
	return `${style}${weight} ${size}px ${run.code ? MONO_FAMILY : FONT_FAMILY}`;
}

function drawFrame(context: CanvasRenderingContext2D, f: TelopFrame, lines: TelopText, width: number, height: number) {
	const rect = { x: f.x * width, y: f.y * height, w: f.w * width, h: f.h * height };
	const padX = f.band ? height * 0.02 : 0;
	const padY = f.band ? height * 0.01 : 0;
	const inner = { w: Math.max(1, rect.w - padX * 2), h: Math.max(1, rect.h - padY * 2) };

	const measureAt = (size: number) => (run: TelopRun) => {
		context.font = fontOf(f, run, size);
		const base = context.measureText(run.text).width;
		if (!run.ruby) return base;
		context.font = fontOf(f, {} as TelopRun, size * RUBY_SCALE);
		return Math.max(base, context.measureText(run.ruby).width);
	};

	// 枠に収まる、いちばん大きな文字の大きさを探す
	const base = f.size * height;
	let block: Block | null = null;
	for (let size = base; ; size *= 0.9) {
		const laid = layoutLines(lines, inner.w, measureAt(size));
		const total = laid.reduce((sum, line) => sum + lineHeight(line, size), 0);
		block = { lines: laid, size, height: total };
		if (total <= inner.h || size < base * 0.35) break;
	}
	if (!block || block.lines.length === 0) return;

	if (f.band) {
		context.globalAlpha = f.bandOpacity;
		context.fillStyle = f.band;
		context.fillRect(rect.x, rect.y, rect.w, rect.h);
		context.globalAlpha = 1;
	}

	const size = block.size;
	const measure = measureAt(size);
	let y =
		f.valign === 'top'
			? rect.y + padY
			: f.valign === 'bottom'
				? rect.y + rect.h - padY - block.height
				: rect.y + (rect.h - block.height) / 2;

	context.textBaseline = 'middle';
	context.textAlign = 'left';
	context.lineJoin = 'round';

	for (const line of block.lines) {
		const widths = line.pieces.map(measure);
		const lineWidth = widths.reduce((sum, w) => sum + w, 0);
		let x =
			f.align === 'left'
				? rect.x + padX
				: f.align === 'right'
					? rect.x + rect.w - padX - lineWidth
					: rect.x + (rect.w - lineWidth) / 2;
		const rubyHeight = line.ruby ? size * RUBY_SCALE : 0;
		const middle = y + rubyHeight + (size * 1.25) / 2;

		line.pieces.forEach((run, index) => {
			const w = widths[index];
			const fill = run.strong ? f.accent : f.color;
			context.font = fontOf(f, run, size);
			const textWidth = context.measureText(run.text).width;
			const left = x + (w - textWidth) / 2;
			if (run.code) {
				// コードは、うすい下地を敷いて区別する
				context.fillStyle = 'rgba(255, 255, 255, 0.16)';
				context.fillRect(left - size * 0.08, middle - size * 0.6, textWidth + size * 0.16, size * 1.2);
			}
			paint(context, run.text, left, middle, fill, f.outline ? size * 0.14 : 0);
			if (run.del || run.link) {
				// 打ち消し線は文字の真ん中、リンクの下線は文字の下に引く
				const lineY = run.del ? middle : middle + size * 0.55;
				context.fillStyle = fill;
				context.fillRect(left, lineY - size * 0.035, textWidth, size * 0.07);
			}
			if (run.ruby) {
				const rubySize = size * RUBY_SCALE;
				context.font = fontOf(f, {} as TelopRun, rubySize);
				const rubyWidth = context.measureText(run.ruby).width;
				paint(context, run.ruby, x + (w - rubyWidth) / 2, y + rubyHeight / 2 + rubySize * 0.1, fill, f.outline ? rubySize * 0.14 : 0);
			}
			x += w;
		});
		y += lineHeight(line, size);
	}
}

/** 文字を描く（縁取りの太さが 0 より大きければ、先に黒で縁取る） */
function paint(context: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, outline: number) {
	if (outline > 0) {
		context.lineWidth = outline;
		context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
		context.strokeText(text, x, y);
	}
	context.fillStyle = fill;
	context.fillText(text, x, y);
}
