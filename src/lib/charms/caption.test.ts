import { describe, expect, it } from 'vitest';
import { splitLyrics, wrapText } from './caption';
import { formatBytes, formatDuration, recordingFileName } from './recorder';

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

describe('splitLyrics', () => {
	it('1行を1画面として分け、途中の空行は「何も出さない」として残す', () => {
		expect(splitLyrics(' 一番 \n\n二番\n\n\n')).toEqual(['一番', '', '二番']);
		expect(splitLyrics('')).toEqual([]);
	});
});

describe('録画の表示用の整形', () => {
	it('ファイル名に端末の名前と日時が入り、使えない文字は置き換える', () => {
		const at = new Date(2026, 10, 16, 9, 5, 7);
		expect(recordingFileName('体育館 カメラ/1', 'mp4', at)).toBe('体育館_カメラ_1_2026-11-16_09-05-07.mp4');
		expect(recordingFileName('???', 'webm', at)).toBe('CHARMS_2026-11-16_09-05-07.webm');
	});

	it('録画時間とデータ量を読みやすい形にする', () => {
		expect(formatDuration(65_000)).toBe('1:05');
		expect(formatDuration(3_723_000)).toBe('1:02:03');
		expect(formatBytes(2048)).toBe('2 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
		expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
	});
});
