import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

import {
	formatRoomCode,
	generateRoomCode,
	generateSecret,
	inviteUrl,
	normalizeRoomCode
} from './room';

describe('合言葉', () => {
	it('6桁の数字を作る（先頭が 0 でも6桁）', () => {
		for (let i = 0; i < 200; i++) {
			expect(generateRoomCode()).toMatch(/^\d{6}$/);
		}
	});

	it('入力のゆれ（全角・空白・ハイフン）を吸収する', () => {
		expect(normalizeRoomCode('123456')).toBe('123456');
		expect(normalizeRoomCode(' 123 456 ')).toBe('123456');
		expect(normalizeRoomCode('123-456')).toBe('123456');
		expect(normalizeRoomCode('１２３　４５６')).toBe('123456');
		expect(normalizeRoomCode('012345')).toBe('012345');
	});

	it('6桁の数字でなければ受け付けない', () => {
		for (const bad of ['', '12345', '1234567', 'abcdef', '12a456', null, undefined]) {
			expect(normalizeRoomCode(bad)).toBeNull();
		}
	});

	it('読みやすく3桁ずつに区切る', () => {
		expect(formatRoomCode('012345')).toBe('012 345');
	});
});

describe('generateSecret', () => {
	it('推測できない長さの、URL に入れられる文字列を作る', () => {
		const a = generateSecret();
		const b = generateSecret();
		expect(a).toMatch(/^[0-9a-f]{48}$/);
		expect(a).not.toBe(b);
	});
});

describe('inviteUrl', () => {
	it('合言葉つきのリンクを作る', () => {
		vi.stubGlobal('location', { origin: 'https://example.test' });
		expect(inviteUrl('123456')).toBe('https://example.test/?room=123456');
		expect(inviteUrl('123456', '/monitor/', { clean: '1', name: '配信用の出力' })).toBe(
			`https://example.test/monitor/?room=123456&clean=1&name=${encodeURIComponent('配信用の出力')}`
		);
		vi.unstubAllGlobals();
	});
});
