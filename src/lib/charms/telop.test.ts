/**
 * テロップの型・文字の折り返し・届いたデータの確かめのテスト
 */

import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, recordingFileName } from './recorder';
import {
	BUILTIN_TEMPLATES,
	findFrame,
	findTemplate,
	isBlankScene,
	layoutLines,
	MAX_TELOP_TEXT,
	mergeTemplates,
	sanitizeScene,
	wrapText,
	type TelopRun
} from './telop';

// 1文字を幅 1 として数える、テスト用の物差し
const measure = (text: string) => [...text].length;

describe('wrapText', () => {
	it('幅に収まる文字列は1行のまま', () => {
		expect(wrapText('こんにちは', 10, measure)).toEqual(['こんにちは']);
	});

	it('日本語は幅に合わせて1文字単位で折り返す', () => {
		expect(wrapText('あいうえおかきくけこ', 4, measure)).toEqual(['あいうえ', 'おかきく', 'けこ']);
	});

	it('英単語は途中で切らず、単語の区切りで折り返す', () => {
		expect(wrapText('Hello wonderful world', 12, measure)).toEqual(['Hello', 'wonderful', 'world']);
	});

	it('句読点や小さい「っ」が行の先頭に来ないようにする', () => {
		expect(wrapText('あいうえ、おかき', 4, measure)).toEqual(['あいうえ、', 'おかき']);
		expect(wrapText('がんばって', 3, measure)).toEqual(['がんばっ', 'て']);
	});

	it('改行はそのまま行の区切りになり、前後の空行は取り除く', () => {
		expect(wrapText('\n一行目\n\n三行目\n', 10, measure)).toEqual(['一行目', '', '三行目']);
	});

	it('空の文字列は行なしになる', () => {
		expect(wrapText('', 10, measure)).toEqual([]);
		expect(wrapText('  \n ', 10, measure)).toEqual([]);
	});
});

describe('飾り付きの文字の折り返し', () => {
	const width = (run: TelopRun) => Math.max(measure(run.text), run.ruby ? measure(run.ruby) / 2 : 0);

	it('ルビを付けた語は途中で折り返さず、ルビのある行を知らせる', () => {
		const lines = layoutLines([[{ text: 'あい' }, { text: '勇気', ruby: 'ゆうき' }]], 3, width);
		expect(lines).toEqual([
			{ pieces: [{ text: 'あい' }], ruby: false },
			{ pieces: [{ text: '勇気', ruby: 'ゆうき' }], ruby: true }
		]);
	});

	it('同じ飾りが続く文字は、ひとまとまりにする', () => {
		const lines = layoutLines([[{ text: 'あい', strong: true }, { text: 'う', strong: true }, { text: 'え' }]], 10, width);
		expect(lines[0].pieces).toEqual([{ text: 'あいう', strong: true }, { text: 'え' }]);
	});
});

describe('型', () => {
	it('最初から4つの型があり、名前の表記ゆれがあっても見つかる', () => {
		expect(BUILTIN_TEMPLATES.map((t) => t.name)).toEqual(['歌詞（3か所）', '歌詞（下に1〜2行）', '演目タイトル', '名前の帯']);
		expect(findTemplate(BUILTIN_TEMPLATES, '歌詞(3か所)')?.id).toBe('lyrics3');
		expect(findTemplate(BUILTIN_TEMPLATES, '歌詞（下に1～2行）')?.id).toBe('lyrics-bottom');
		expect(findTemplate(BUILTIN_TEMPLATES, '名前')?.id).toBe('nameplate');
		// 「歌詞」だけでは2つに当てはまるので、決めない
		expect(findTemplate(BUILTIN_TEMPLATES, '歌詞')).toBeNull();
		expect(findFrame(BUILTIN_TEMPLATES[0], ' 左上 ')?.id).toBe('tl');
	});

	it('保存しておいた調整を読み込み、自分で増やした型は後ろに並べる', () => {
		const changed = { ...BUILTIN_TEMPLATES[0], background: '#112233' };
		const custom = { ...BUILTIN_TEMPLATES[2], id: 'custom-1', name: '自分の型' };
		const merged = mergeTemplates([changed, custom, { broken: true }]);
		expect(merged.map((t) => t.id)).toEqual(['lyrics3', 'lyrics-bottom', 'title', 'nameplate', 'custom-1']);
		expect(merged[0].background).toBe('#112233');
		expect(mergeTemplates(null)).toHaveLength(4);
	});
});

describe('届いた場面の確かめ', () => {
	const template = BUILTIN_TEMPLATES[0];

	it('型にない枠と、空の文字は取り除く', () => {
		const scene = sanitizeScene({
			template,
			texts: { tl: [[{ text: 'そうだ', strong: true, extra: 1 }]], nowhere: [[{ text: 'x' }]], br: [[{ text: '  ' }]] }
		});
		expect(scene?.texts).toEqual({ tl: [[{ text: 'そうだ', strong: true }]] });
		expect(isBlankScene(scene)).toBe(false);
		expect(isBlankScene(sanitizeScene({ template, texts: {} }))).toBe(true);
	});

	it('おかしな値は直し、長すぎる文字は切り詰め、読めないものは null', () => {
		const scene = sanitizeScene({
			template: { ...template, background: 'red', frames: [{ ...template.frames[0], x: 5, size: -1 }] },
			texts: { tl: [[{ text: 'あ'.repeat(1000) }]] }
		});
		expect(scene?.template.background).toBe('#000000');
		expect(scene?.template.frames[0].x).toBe(0.98);
		expect(scene?.template.frames[0].size).toBe(0.01);
		expect(scene?.texts.tl[0][0].text).toHaveLength(MAX_TELOP_TEXT);
		expect(sanitizeScene({ template: { id: 'x', name: 'x', frames: [] } })).toBeNull();
		expect(sanitizeScene('scene')).toBeNull();
	});
});

describe('録画の表示用の整形', () => {
	it('ファイル名に端末の名前と日時が入り、使えない文字は置き換える', () => {
		const at = new Date(2026, 10, 16, 9, 5, 7);
		expect(recordingFileName('体育館 カメラ/1', 'mp4', at)).toBe('体育館_カメラ_1_2026-11-16_09-05-07.mp4');
		expect(recordingFileName('???', 'webm', at)).toBe('CHARMPoint_2026-11-16_09-05-07.webm');
	});

	it('録画時間とデータ量を読みやすい形にする', () => {
		expect(formatDuration(65_000)).toBe('1:05');
		expect(formatDuration(3_723_000)).toBe('1:02:03');
		expect(formatBytes(2048)).toBe('2 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
		expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
	});
});
