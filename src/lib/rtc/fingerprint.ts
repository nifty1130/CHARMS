/**
 * DTLS フィンガープリントの操作
 *
 * フィンガープリントは端末ごとの証明書のハッシュ値（SHA-256、32バイト）。
 * 接続相手が本当に QR を読み取った相手かどうかを保証する、セキュリティの要。
 */

import { FINGERPRINT_SIZE } from './constants';

/**
 * SDP 形式（`E7:3B:38:...`）のフィンガープリントをバイト列にする
 *
 * @param text コロン区切りの16進文字列
 * @returns 32バイトのフィンガープリント。形式が正しくないときは null
 */
export function parseFingerprint(text: string): Uint8Array | null {
	const hex = text.replace(/:/g, '');
	if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== FINGERPRINT_SIZE * 2) return null;

	const bytes = new Uint8Array(FINGERPRINT_SIZE);
	for (let i = 0; i < FINGERPRINT_SIZE; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * フィンガープリントを SDP 形式（`E7:3B:38:...`）の文字列にする
 *
 * @param fingerprint 32バイトのフィンガープリント
 * @returns コロン区切りの16進文字列
 */
export function formatFingerprint(fingerprint: Uint8Array): string {
	return Array.from(fingerprint, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/**
 * 2つのフィンガープリントの大小を比べる
 *
 * 両方の端末が同じ結果を得られるので、役割分担（どちらが DTLS のサーバー役か）を
 * 通信なしで決めるのに使う。
 *
 * @returns a が大きければ 1、小さければ -1、同じなら 0
 */
export function compareFingerprints(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
	for (let i = 0; i < FINGERPRINT_SIZE; i++) {
		if (a[i] > b[i]) return 1;
		if (a[i] < b[i]) return -1;
	}
	return 0;
}

/**
 * 2つのフィンガープリントから4桁の確認コードを作る
 *
 * 両方の端末で同じ数字になる。画面に表示して見比べれば、
 * 間に第三者が割り込んでいないことを人の目で確かめられる。
 *
 * @param local 自分のフィンガープリント
 * @param remote 相手のフィンガープリント
 * @returns 4桁の数字（例: "0427"）
 */
export async function generateVerificationCode(
	local: Uint8Array,
	remote: Uint8Array
): Promise<string> {
	// どちらの端末でも同じ並びになるよう、大きい方を先に置く
	const [first, second] = compareFingerprints(local, remote) >= 0 ? [local, remote] : [remote, local];

	const combined = new Uint8Array(FINGERPRINT_SIZE * 2);
	combined.set(first, 0);
	combined.set(second, FINGERPRINT_SIZE);

	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
	const value = ((hash[0] << 8) | hash[1]) % 10000;
	return value.toString().padStart(4, '0');
}
