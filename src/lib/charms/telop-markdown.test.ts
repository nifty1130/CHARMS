/**
 * 歌詞の台本（Markdown）の読み取りのテスト
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, plainText, type TelopText } from './telop';
import { parseField, parseScript, screenAt, type ScriptSong, type ScriptStep } from './telop-markdown';

const parse = (source: string) => parseScript(source, BUILTIN_TEMPLATES);

/** 画面の中身を、枠の ID ごとの文字だけにする */
function screen(song: ScriptSong, index: number): Record<string, string> {
	return Object.fromEntries(
		Object.entries(screenAt(song, index)).map(([frame, text]) => [frame, plainText(text, '/')])
	);
}

/** 送りの一覧を、読みやすい形にする */
function steps(song: ScriptSong): string[] {
	return song.steps.map((step: ScriptStep) =>
		step.kind === 'clear'
			? '（消す）'
			: `${step.fresh ? '◆' : ''}${step.items.map((item) => `${item.frame}=${plainText(item.text, '/')}`).join(' + ')}`
	);
}

describe('昔の書き方（SU / SD / F / Clear）', () => {
	it('記事の文化祭の台本を、そのまま読める', () => {
		const { songs, warnings } = parse(
			['SU そうだ', 'SD うれしいんだ', 'F 生きるよろこび', 'Clear', 'SU 愛と', 'SD 勇気だけが', 'F 友達さ'].join('\n')
		);
		expect(warnings).toEqual([]);
		expect(songs).toHaveLength(1);
		const [song] = songs;
		expect(song.template.id).toBe('lyrics3');
		expect(steps(song)).toEqual([
			'◆tl=そうだ',
			'br=うれしいんだ',
			'center=生きるよろこび',
			'（消す）',
			'tl=愛と',
			'br=勇気だけが',
			'center=友達さ'
		]);
		// 送るたびに積み重なり、Clear で消える
		expect(screen(song, 2)).toEqual({ tl: 'そうだ', br: 'うれしいんだ', center: '生きるよろこび' });
		expect(screen(song, 3)).toEqual({});
		expect(screen(song, 4)).toEqual({ tl: '愛と' });
	});
});

describe('Markdown の書き方', () => {
	it('見出し1で曲が分かれ、型の指定・枠の名前・空行・区切り線を読む', () => {
		const { songs, warnings } = parse(
			[
				'# 怪獣の花唄',
				'型: 歌詞（3か所）',
				'> 前奏なし。いきなり歌い出し',
				'',
				'左上: そうだ',
				'右下: うれしいんだ',
				'生きるよろこび',
				'',
				'左上：愛と',
				'',
				'---',
				'',
				'# 次の曲',
				'<!-- 型: 歌詞（下に1〜2行） -->',
				'大空を見上げて'
			].join('\n')
		);
		expect(warnings).toEqual([]);
		expect(songs.map((song) => [song.title, song.template.id])).toEqual([
			['怪獣の花唄', 'lyrics3'],
			['次の曲', 'lyrics-bottom']
		]);
		const [first, second] = songs;
		expect(steps(first)).toEqual(['◆tl=そうだ', 'br=うれしいんだ', 'center=生きるよろこび', '◆tl=愛と', '（消す）']);
		// メモは、次の送りに付く
		expect(first.steps[0].notes).toEqual([{ kind: 'memo', text: '前奏なし。いきなり歌い出し' }]);
		// 空行のあとの送りで、画面が入れ替わる
		expect(screen(first, 3)).toEqual({ tl: '愛と' });
		expect(steps(second)).toEqual(['◆main=大空を見上げて']);
	});

	it('箇条書きは、まとめて1回で出す', () => {
		const { songs } = parse(['- 左上: 愛と', '- 右下: 勇気だけが', '', '友達さ'].join('\n'));
		expect(steps(songs[0])).toEqual(['◆tl=愛と + br=勇気だけが', '◆center=友達さ']);
	});

	it('番号付きの箇条書きとチェックボックスは、印も出す', () => {
		const { songs } = parse(['1. 一番', '2. 二番', '', '- [x] 済み', '- [ ] まだ'].join('\n'));
		expect(steps(songs[0])).toEqual(['◆center=1. 一番/2. 二番', '◆center=☑ 済み/☐ まだ']);
	});

	it('行末の \\ と <br> は、同じ枠の中の改行になる', () => {
		const { songs } = parse(['中央: 一行目\\', '二行目', '三行目<br>四行目'].join('\n'));
		expect(steps(songs[0])).toEqual(['◆center=一行目/二行目', 'center=三行目/四行目']);
	});

	it('強調・斜体・打ち消し線・コード・リンク・ルビを読む', () => {
		const { songs } = parse('**生きる** *よろこび* ~~消し~~ `code` [リンク](https://example.com) {愛|あい}');
		const step = songs[0].steps[0];
		expect(step.kind).toBe('show');
		if (step.kind !== 'show') return;
		const runs = step.items[0].text[0];
		expect(runs).toEqual([
			{ text: '生きる', strong: true },
			{ text: ' ' },
			{ text: 'よろこび', em: true },
			{ text: ' ' },
			{ text: '消し', del: true },
			{ text: ' ' },
			{ text: 'code', code: true },
			{ text: ' ' },
			{ text: 'リンク', link: true },
			{ text: ' ' },
			{ text: '愛', ruby: 'あい' }
		]);
	});

	it('見出し2以降は、操作する人だけに見える区切りの見出しになる', () => {
		const { songs } = parse(['# 曲', '## 1番', 'そうだ'].join('\n'));
		expect(songs[0].steps[0].notes).toEqual([{ kind: 'section', text: '1番' }]);
	});

	it('コードは書いたままの文字で1回に出し、枠の名前を指定できる', () => {
		const { songs } = parse(['```左上', '**そのまま**', '  字下げ', '```'].join('\n'));
		const step = songs[0].steps[0];
		expect(steps(songs[0])).toEqual(['◆tl=**そのまま**/  字下げ']);
		if (step.kind === 'show') expect(step.items[0].text[0][0].code).toBe(true);
	});

	it('表は1回で出し、画像は説明の文字を出し、脚注はメモになる', () => {
		const { songs } = parse(
			['| パート | 名前 |', '|---|---|', '| Vo | 山田 |', '', '![学校のロゴ](logo.png)', '', '歌詞[^1]', '', '[^1]: 二番は省略'].join('\n')
		);
		expect(steps(songs[0])).toEqual(['◆center=パート　名前/Vo　山田', '◆center=学校のロゴ', '◆center=歌詞']);
		expect(songs[0].notes).toEqual([{ kind: 'memo', text: '注 1: 二番は省略' }]);
	});

	it('枠の名前でない「〜:」は、そのまま歌詞として出す', () => {
		const { songs, warnings } = parse('Love: 愛');
		expect(steps(songs[0])).toEqual(['◆center=Love: 愛']);
		expect(warnings).toEqual([]);
	});
});

describe('書き方の注意', () => {
	it('歌詞の行のすぐ下の --- は、見出しになることを知らせる', () => {
		const { songs, warnings } = parse(['中央: 友達さ', '---'].join('\n'));
		expect(steps(songs[0])).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].line).toBe(1);
		expect(warnings[0].message).toMatch(/見出しになり/);
	});

	it('「>」のメモのすぐ次の行は、メモの続きになることを知らせる', () => {
		const { songs, warnings } = parse(['> 間奏 8小節', '左上: そうだ'].join('\n'));
		expect(steps(songs[0])).toEqual([]);
		expect(warnings.map((w) => w.line)).toEqual([2]);
		expect(warnings[0].message).toMatch(/メモ）の続き/);
	});

	it('見つからない型と、型にない枠の名前を知らせる', () => {
		const { songs, warnings } = parse(['型: ないもの', '', '演目名: そうだ'].join('\n'));
		expect(songs[0].template.id).toBe('lyrics3');
		expect(warnings.map((w) => w.line)).toEqual([1, 3]);
		expect(steps(songs[0])).toEqual(['◆center=演目名: そうだ']);
	});

	it('字下げした行がコードとして読まれたことを知らせる', () => {
		const { warnings } = parse('    字下げした歌詞');
		expect(warnings[0].message).toMatch(/コード/);
	});
});

describe('フォームの入力', () => {
	it('Markdown として読み、改行は枠の中の改行にする', () => {
		const text: TelopText = parseField('3年A組\n**合唱**');
		expect(text).toEqual([[{ text: '3年A組' }], [{ text: '合唱', strong: true }]]);
		expect(parseField('   ')).toEqual([]);
	});
});
