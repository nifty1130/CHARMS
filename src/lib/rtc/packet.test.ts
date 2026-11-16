import { describe, expect, it } from 'vitest';
import { base45Decode, base45Encode } from './base45';
import { PACKET_VERSION } from './constants';
import { PacketDecodeError, PacketEncodeError } from './errors';
import { decodePacket, encodePacket, packetFromQrText, packetToQrText } from './packet';
import type { SignalCandidate } from './types';

const fingerprint = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
const ufrag = '6M6e';
const pwd = 'rHBDs1J/TSVRZugzsDt05Mpr';

const candidates: SignalCandidate[] = [
	{ address: '192.168.1.23', port: 54321, kind: 'host', protocol: 'udp' },
	{
		address: '812d4c56-c1e9-41e3-ba8a-d88e922339e2.local',
		port: 63613,
		kind: 'host',
		protocol: 'udp'
	},
	{ address: '2001:db8::8a2e:370:7334', port: 9, kind: 'host', protocol: 'tcp', tcpType: 'active' },
	{ address: '203.0.113.5', port: 1, kind: 'srflx', protocol: 'udp' }
];

describe('base45', () => {
	it('RFC 9285 のテストベクタと一致する', () => {
		const encode = (text: string) => base45Encode(new TextEncoder().encode(text));
		expect(encode('AB')).toBe('BB8');
		expect(encode('Hello!!')).toBe('%69 VD92EX0');
		expect(encode('base-45')).toBe('UJCLQE7W581');
		expect(new TextDecoder().decode(base45Decode('QED8WEX0'))).toBe('ietf!');
	});

	it('あらゆる長さのバイト列を往復できる', () => {
		for (let length = 0; length < 40; length++) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
			expect(base45Decode(base45Encode(bytes))).toEqual(bytes);
		}
	});

	it('Base45 ではない文字列を拒否する', () => {
		expect(() => base45Decode('abc')).toThrow(PacketDecodeError); // 小文字は使えない
		expect(() => base45Decode('A')).toThrow(PacketDecodeError); // 長さが不正
		expect(() => base45Decode(':::')).toThrow(PacketDecodeError); // 65535 を超える
	});
});

describe('encodePacket / decodePacket', () => {
	it('パケットを往復できる', () => {
		const decoded = decodePacket(encodePacket({ fingerprint, ufrag, pwd, candidates }));
		expect(decoded).toEqual({ version: PACKET_VERSION, fingerprint, ufrag, pwd, candidates });
	});

	it('IPv4 候補1件なら 71 バイトに収まる', () => {
		const bytes = encodePacket({ fingerprint, ufrag, pwd, candidates: [candidates[0]] });
		// ヘッダー2 + フィンガープリント32 + ufrag(1+4) + pwd(1+24) + 候補7
		expect(bytes.length).toBe(71);
	});

	it('QR 用の文字列は英数字モードの文字だけで、往復できる', () => {
		const text = packetToQrText({ fingerprint, ufrag, pwd, candidates });
		expect(text).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
		expect(packetFromQrText(` ${text}\n`).candidates).toEqual(candidates);
	});

	it('不正な入力ではエンコードに失敗する', () => {
		const ok = { fingerprint, ufrag, pwd, candidates: [] };
		expect(() => encodePacket({ ...ok, fingerprint: new Uint8Array(31) })).toThrow(
			PacketEncodeError
		);
		expect(() => encodePacket({ ...ok, ufrag: 'ab\r\ncd' })).toThrow(PacketEncodeError);
		expect(() => encodePacket({ ...ok, pwd: '' })).toThrow(PacketEncodeError);
		expect(() =>
			encodePacket({ ...ok, candidates: [{ ...candidates[0], address: 'example.com' }] })
		).toThrow(PacketEncodeError);
		expect(() => encodePacket({ ...ok, candidates: [{ ...candidates[0], port: 0 }] })).toThrow(
			PacketEncodeError
		);
	});

	it('CHARMS のパケットではないデータを拒否する', () => {
		expect(() => decodePacket(new Uint8Array(0))).toThrow(PacketDecodeError);
		expect(() => decodePacket(new TextEncoder().encode('https://example.com'))).toThrow(
			PacketDecodeError
		);
	});

	it('バージョンが違うパケットを拒否する', () => {
		const bytes = encodePacket({ fingerprint, ufrag, pwd, candidates });
		bytes[1] = 0; // 本家 QWBP
		expect(() => decodePacket(bytes)).toThrow(/バージョン/);
	});

	it('途中で切れたパケットを拒否する', () => {
		const bytes = encodePacket({ fingerprint, ufrag, pwd, candidates });
		// 64 バイト目まで（候補0件）は正しいパケットなので、それ以外の位置で切る
		for (const length of [2, 20, 34, 40, 63, 66, bytes.length - 1]) {
			expect(() => decodePacket(bytes.slice(0, length))).toThrow(PacketDecodeError);
		}
	});

	it('認証情報に改行が混ざったパケットを拒否する（SDP への行の差し込み対策）', () => {
		const bytes = encodePacket({ fingerprint, ufrag, pwd, candidates });
		bytes[35] = 0x0a; // ufrag の1文字目を改行にする
		expect(() => decodePacket(bytes)).toThrow(PacketDecodeError);
	});
});
