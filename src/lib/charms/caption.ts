/**
 * テロップの描画
 *
 * テロップ（Admin）は「文字版のカメラ」。文字をキャンバスに描き、それを映像として送る。
 * ここでは、文字を画面に収まるように折り返し、大きさを調整して描く。
 */

/** 画面に出す1枚分の内容 */
export interface Caption {
	/** 大きく出す文字（タイトルや歌詞の1行） */
	title: string;
	/** その下に小さく出す文字（出演者や補足） */
	subtitle: string;
}

/** テロップの映像の大きさ（16:9） */
export const CAPTION_WIDTH = 1280;
export const CAPTION_HEIGHT = 720;

/** テロップの映像のコマ数（文字は動かないので少なくてよい） */
export const CAPTION_FRAME_RATE = 15;

/** 行の先頭に来ると読みにくい文字（前の行の末尾に残す） */
const NO_LINE_START = new Set('、。，．,.！？!?）」』】〕〉》ー～…・ゃゅょっャュョッ');

const FONT_FAMILY =
	"'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Noto Sans JP', Meiryo, sans-serif";

/**
 * 文字列を、折り返しの単位に分ける
 *
 * 日本語は1文字ずつ、英単語や数字はひとかたまりとして扱う（単語の途中で折り返さない）。
 */
function tokenize(text: string): string[] {
	return text.match(/[!-~]+|\s+|./gu) ?? [];
}

/**
 * 文字列を、指定した幅に収まるように折り返す
 *
 * @param text 折り返す文字列（改行はそのまま行の区切りになる）
 * @param maxWidth 1行の最大幅
 * @param measure 文字列の幅を測る関数
 * @returns 行ごとの文字列
 */
export function wrapText(
	text: string,
	maxWidth: number,
	measure: (text: string) => number
): string[] {
	const lines: string[] = [];

	for (const paragraph of text.split(/\r?\n/)) {
		let line = '';
		for (const token of tokenize(paragraph)) {
			if (line === '' && /^\s+$/.test(token)) continue; // 行頭の空白は捨てる
			if (line === '' || measure(line + token) <= maxWidth || NO_LINE_START.has(token)) {
				line += token;
			} else {
				lines.push(line.trimEnd());
				line = /^\s+$/.test(token) ? '' : token;
			}
		}
		lines.push(line.trimEnd());
	}

	// 前後の空行は取り除く（途中の空行は、意図した行間として残す）
	while (lines.length > 0 && lines[0] === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

interface Block {
	lines: string[];
	fontSize: number;
	lineHeight: number;
}

/**
 * 文字が指定した行数に収まる、いちばん大きな文字サイズを探す
 */
function fit(
	context: CanvasRenderingContext2D,
	text: string,
	weight: number,
	maxWidth: number,
	sizes: number[],
	maxLines: number
): Block {
	let block: Block = { lines: [], fontSize: sizes[0], lineHeight: sizes[0] * 1.3 };
	for (const fontSize of sizes) {
		context.font = `${weight} ${fontSize}px ${FONT_FAMILY}`;
		const lines = wrapText(text, maxWidth, (value) => context.measureText(value).width);
		block = { lines, fontSize, lineHeight: fontSize * 1.3 };
		if (lines.length <= maxLines) break;
	}
	return block;
}

/**
 * テロップを描く（黒い背景に白い文字。中央ぞろえ）
 *
 * @param context 描く先のキャンバス
 * @param caption 出す内容（どちらも空なら黒い画面になる）
 */
export function drawCaption(context: CanvasRenderingContext2D, caption: Caption): void {
	const width = CAPTION_WIDTH;
	const height = CAPTION_HEIGHT;
	const maxWidth = width * 0.86;

	context.fillStyle = '#000';
	context.fillRect(0, 0, width, height);

	const title = caption.title.trim();
	const subtitle = caption.subtitle.trim();
	if (!title && !subtitle) return;

	const titleBlock = title ? fit(context, title, 700, maxWidth, [112, 96, 80, 68, 56, 48], 3) : null;
	const subtitleBlock = subtitle ? fit(context, subtitle, 400, maxWidth, [52, 44, 38, 32], 2) : null;
	const gap = titleBlock && subtitleBlock ? titleBlock.fontSize * 0.45 : 0;

	const blockHeight = (block: Block | null) => (block ? block.lines.length * block.lineHeight : 0);
	let y = (height - blockHeight(titleBlock) - gap - blockHeight(subtitleBlock)) / 2;

	context.textAlign = 'center';
	context.textBaseline = 'middle';

	const draw = (block: Block | null, weight: number, color: string) => {
		if (!block) return;
		context.font = `${weight} ${block.fontSize}px ${FONT_FAMILY}`;
		context.fillStyle = color;
		for (const line of block.lines) {
			context.fillText(line, width / 2, y + block.lineHeight / 2);
			y += block.lineHeight;
		}
	};

	draw(titleBlock, 700, '#fff');
	y += gap;
	draw(subtitleBlock, 400, '#d4d4d8');
}

/** 歌詞のテキストを、1画面ずつの行に分ける（空行は「何も出さない」として残す） */
export function splitLyrics(text: string): string[] {
	const lines = text.split(/\r?\n/).map((line) => line.trim());
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}
