import { describe, expect, it } from 'vitest';
import { addressRank, decodeAddress, encodeAddress } from './address';
import {
	compareFingerprints,
	formatFingerprint,
	generateVerificationCode,
	parseFingerprint
} from './fingerprint';
import {
	buildCandidateInit,
	buildRemoteAnswer,
	parseCandidateLine,
	parseLocalDescription,
	selectCandidates
} from './sdp';
import { AddressFamily } from './types';

const FINGERPRINT =
	'BC:9A:D5:56:BD:E5:5C:36:00:49:24:38:72:56:31:6F:45:F3:FB:68:3A:88:CE:40:8B:49:75:73:7F:D2:F1:A7';

// Chrome が生成する DataChannel 専用 Offer（候補の収集後）
const CHROME_OFFER = [
	'v=0',
	'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
	's=-',
	't=0 0',
	'a=group:BUNDLE 0',
	'a=extmap-allow-mixed',
	'a=msid-semantic: WMS',
	'm=application 63613 UDP/DTLS/SCTP webrtc-datachannel',
	'c=IN IP4 192.168.1.23',
	'a=candidate:1061054028 1 udp 2113937151 812d4c56-c1e9-41e3-ba8a-d88e922339e2.local 63613 typ host generation 0 network-cost 999',
	'a=candidate:2 1 udp 2122194687 fe80::1c2d:3e4f:5a6b:7c8d 50001 typ host generation 0',
	'a=candidate:3 1 udp 2122260223 192.168.1.23 50002 typ host generation 0 network-id 1',
	'a=candidate:4 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0',
	'a=candidate:5 1 udp 2122129151 2001:db8::1 50003 typ host generation 0',
	'a=candidate:6 2 udp 2122260222 192.168.1.23 50004 typ host generation 0',
	'a=ice-ufrag:6M6e',
	'a=ice-pwd:rHBDs1J/TSVRZugzsDt05Mpr',
	'a=ice-options:trickle',
	`a=fingerprint:sha-256 ${FINGERPRINT}`,
	'a=setup:actpass',
	'a=mid:0',
	'a=sctp-port:5000',
	'a=max-message-size:262144',
	''
].join('\r\n');

describe('address', () => {
	it('IPv4 / IPv6 / mDNS を往復できる', () => {
		for (const address of [
			'192.168.1.23',
			'2001:db8::8a2e:370:7334',
			'812d4c56-c1e9-41e3-ba8a-d88e922339e2.local'
		]) {
			const encoded = encodeAddress(address)!;
			expect(decodeAddress(encoded.family, encoded.bytes)).toBe(address);
		}
	});

	it('省略形の IPv6 を16バイトにできる', () => {
		const encoded = encodeAddress('::1')!;
		expect(encoded.family).toBe(AddressFamily.IPv6);
		expect(encoded.bytes).toEqual(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
	});

	it('パケットに入れられないアドレスは null になる', () => {
		expect(encodeAddress('example.com')).toBeNull();
		expect(encodeAddress('mydevice.local')).toBeNull(); // UUID 形式ではない mDNS
		expect(encodeAddress('192.168.1')).toBeNull();
		expect(encodeAddress('fe80::1%eth0')).toBeNull();
	});

	it('IPv4 を最優先にし、届かないアドレスは除外する', () => {
		expect(addressRank('192.168.1.23')).toBe(0);
		expect(addressRank('812d4c56-c1e9-41e3-ba8a-d88e922339e2.local')).toBe(1);
		expect(addressRank('2001:db8::1')).toBe(2);
		expect(addressRank('127.0.0.1')).toBe(3);
		expect(addressRank('fe80::1')).toBeNull();
		expect(addressRank('0.0.0.0')).toBeNull();
	});
});

describe('fingerprint', () => {
	it('SDP 形式とバイト列を往復できる', () => {
		const bytes = parseFingerprint(FINGERPRINT)!;
		expect(bytes.length).toBe(32);
		expect(formatFingerprint(bytes)).toBe(FINGERPRINT);
	});

	it('形式が正しくないものは null になる', () => {
		expect(parseFingerprint('BC:9A')).toBeNull();
		expect(parseFingerprint('ZZ'.repeat(32))).toBeNull();
	});

	it('確認コードは4桁で、どちらの端末から計算しても同じになる', async () => {
		const a = parseFingerprint(FINGERPRINT)!;
		const b = Uint8Array.from(a).reverse();
		expect(compareFingerprints(a, b)).toBe(-compareFingerprints(b, a));
		expect(compareFingerprints(a, a)).toBe(0);

		const code = await generateVerificationCode(a, b);
		expect(code).toMatch(/^\d{4}$/);
		expect(await generateVerificationCode(b, a)).toBe(code);
	});
});

describe('sdp', () => {
	it('Chrome の Offer から QR に必要な情報を取り出せる', () => {
		const info = parseLocalDescription(CHROME_OFFER)!;
		expect(formatFingerprint(info.fingerprint)).toBe(FINGERPRINT);
		expect(info.ufrag).toBe('6M6e');
		expect(info.pwd).toBe('rHBDs1J/TSVRZugzsDt05Mpr');
		expect(info.mid).toBe('0');
		// リンクローカル IPv6 とコンポーネント 2 は除外される
		expect(info.candidates.map((c) => `${c.protocol}:${c.port}`)).toEqual([
			'udp:63613',
			'udp:50002',
			'tcp:9',
			'udp:50003'
		]);
	});

	it('必要な行がない SDP は null になる', () => {
		expect(parseLocalDescription('v=0\r\n')).toBeNull();
		expect(parseLocalDescription(CHROME_OFFER.replace(/a=ice-pwd:.*\r\n/, ''))).toBeNull();
	});

	it('候補を UDP に絞り、IPv4 → mDNS → IPv6 の順で上限まで選ぶ', () => {
		const info = parseLocalDescription(CHROME_OFFER)!;
		expect(selectCandidates(info.candidates, 4).map((c) => c.port)).toEqual([50002, 63613, 50003]);
		expect(selectCandidates(info.candidates, 1).map((c) => c.port)).toEqual([50002]);
		expect(selectCandidates([...info.candidates, ...info.candidates], 4)).toHaveLength(3);
	});

	it('TCP 候補の接続方式を読み取れる', () => {
		expect(
			parseCandidateLine('candidate:4 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active')
		).toEqual({
			address: '192.168.1.23',
			port: 9,
			kind: 'host',
			protocol: 'tcp',
			tcpType: 'active'
		});
		expect(parseCandidateLine('candidate:9 1 udp 1 192.168.1.23 5 typ relay')).toBeNull();
		expect(parseCandidateLine('not a candidate')).toBeNull();
	});

	it('相手側の Answer を組み立てられる', () => {
		const info = parseLocalDescription(CHROME_OFFER)!;
		const sdp = buildRemoteAnswer(info, 'active', '0');
		expect(sdp).toContain(`a=fingerprint:sha-256 ${FINGERPRINT}\r\n`);
		expect(sdp).toContain('a=ice-ufrag:6M6e\r\n');
		expect(sdp).toContain('a=setup:active\r\n');
		expect(sdp.endsWith('\r\n')).toBe(true);
		expect(sdp.split('\r\n').every((line) => !line.includes('\n'))).toBe(true);
	});

	it('SDP に行を差し込もうとする値を拒否する', () => {
		const info = parseLocalDescription(CHROME_OFFER)!;
		expect(() =>
			buildRemoteAnswer({ ...info, ufrag: 'x\r\na=setup:passive' }, 'active', '0')
		).toThrow();
		expect(() => buildRemoteAnswer(info, 'active', '0\r\na=x')).toThrow();
	});

	it('addIceCandidate に渡す候補を組み立てられる', () => {
		expect(
			buildCandidateInit({ address: '192.168.1.23', port: 50002, kind: 'host', protocol: 'udp' }, 0, '0')
		).toEqual({
			candidate: 'candidate:1 1 udp 2122260223 192.168.1.23 50002 typ host',
			sdpMid: '0'
		});
	});
});
