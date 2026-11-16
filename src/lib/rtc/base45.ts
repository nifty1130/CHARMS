/**
 * Base45 エンコード（RFC 9285）
 *
 * QR コードの「英数字モード」で使える45文字だけでバイト列を表す方式。
 * バイナリをそのまま QR に入れると読み取りライブラリによって文字化けするため、
 * いったん Base45 の文字列にしてから QR にする。Base64 より QR が小さくなる。
 */

import { PacketDecodeError } from './errors';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const LOOKUP = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

/**
 * バイト列を Base45 文字列に変換する
 *
 * @param bytes 変換するバイト列
 * @returns Base45 文字列
 */
export function base45Encode(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i + 1 < bytes.length; i += 2) {
		// 2バイトを3文字にする
		const value = (bytes[i] << 8) | bytes[i + 1];
		out += ALPHABET[value % 45];
		out += ALPHABET[Math.floor(value / 45) % 45];
		out += ALPHABET[Math.floor(value / 2025)];
	}
	if (bytes.length % 2 === 1) {
		// 余った1バイトは2文字にする
		const value = bytes[bytes.length - 1];
		out += ALPHABET[value % 45];
		out += ALPHABET[Math.floor(value / 45)];
	}
	return out;
}

/**
 * Base45 文字列をバイト列に戻す
 *
 * @param text Base45 文字列
 * @returns 元のバイト列
 * @throws {@link PacketDecodeError} Base45 として正しくない場合
 */
export function base45Decode(text: string): Uint8Array {
	// 先に文字の種類を調べる（URL など無関係な QR を読んだときに、分かりやすい説明を出すため）
	const digits: number[] = [];
	for (const char of text) {
		const digit = LOOKUP.get(char);
		if (digit === undefined) {
			throw new PacketDecodeError('CHARMS の QR コードではありません');
		}
		digits.push(digit);
	}
	if (digits.length % 3 === 1) {
		throw new PacketDecodeError('QR コードの内容が途中で切れています');
	}

	const out = new Uint8Array(Math.floor(digits.length / 3) * 2 + (digits.length % 3 === 2 ? 1 : 0));
	let offset = 0;
	let i = 0;
	for (; i + 2 < digits.length; i += 3) {
		const value = digits[i] + digits[i + 1] * 45 + digits[i + 2] * 2025;
		if (value > 0xffff) {
			throw new PacketDecodeError('CHARMS の QR コードではありません');
		}
		out[offset++] = value >> 8;
		out[offset++] = value & 0xff;
	}
	if (i < digits.length) {
		const value = digits[i] + digits[i + 1] * 45;
		if (value > 0xff) {
			throw new PacketDecodeError('CHARMS の QR コードではありません');
		}
		out[offset++] = value;
	}
	return out;
}
