/**
 * QR コードの往復テスト（実際のブラウザで動かす）
 *
 * 画面に出す QR（qrcode）を、読み取りに使うライブラリ（qr-scanner）で実際に読み、
 * 元の文字列がそのまま戻ることを確かめる。記号や空白を含む Base45 の文字列が、
 * 生成と読み取りの間で化けないことの確認。
 */

import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { describe, expect, it } from 'vitest';
import { QR_ERROR_CORRECTION_LEVEL } from './constants';
import { PeerLink } from './link';
import { packetFromQrText, packetToQrText } from './packet';
import type { SignalCandidate } from './types';

async function roundTrip(text: string, size = 640): Promise<string> {
	const canvas = document.createElement('canvas');
	await QRCode.toCanvas(canvas, text, {
		width: size,
		margin: 2,
		errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL
	});
	const result = await QrScanner.scanImage(canvas, { returnDetailedScanResult: true });
	return result.data;
}

describe('QR コードの生成と読み取り', () => {
	it('実際の接続情報を QR にして読み取ると、同じ文字列が戻る', async () => {
		const link = new PeerLink();
		await link.prepare();
		const text = link.qrText;
		link.close();

		expect(await roundTrip(text)).toBe(text);
	});

	it('候補が最大数（IPv4・mDNS・IPv6 の混在）でも読み取れる', async () => {
		const candidates: SignalCandidate[] = [
			{ address: '192.168.100.123', port: 65535, kind: 'host', protocol: 'udp' },
			{ address: '10.45.31.86', port: 54031, kind: 'host', protocol: 'udp' },
			{
				address: '812d4c56-c1e9-41e3-ba8a-d88e922339e2.local',
				port: 63613,
				kind: 'host',
				protocol: 'udp'
			},
			{ address: '2001:db8:85a3::8a2e:370:7334', port: 50003, kind: 'host', protocol: 'udp' }
		];
		const text = packetToQrText({
			fingerprint: Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff),
			ufrag: 'rt/r',
			pwd: '5yG+6LZWKpPFgOIn0yJzsKSO',
			candidates
		});

		const scanned = await roundTrip(text);
		expect(scanned).toBe(text);
		expect(packetFromQrText(scanned).candidates).toEqual(candidates);
	});

	it('スマホの小さな画面に出した大きさ（240px）でも読み取れる', async () => {
		const text = packetToQrText({
			fingerprint: Uint8Array.from({ length: 32 }, (_, i) => 255 - i),
			ufrag: 'a+b/',
			pwd: 'ABCDEFGHIJKLMNOPQRSTUVWX',
			candidates: [{ address: '192.168.1.23', port: 50002, kind: 'host', protocol: 'udp' }]
		});
		expect(await roundTrip(text, 240)).toBe(text);
	});
});
