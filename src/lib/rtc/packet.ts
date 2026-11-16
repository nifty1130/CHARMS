/**
 * QRシグナリングパケットのエンコード / デコード
 *
 * パケットの構造（バージョン 1）:
 *
 * | 位置 | サイズ | 内容 |
 * |---|---|---|
 * | 0 | 1 | マジックバイト `0x51` |
 * | 1 | 1 | バージョン（下位3ビット） |
 * | 2 | 32 | DTLS フィンガープリント |
 * | 34 | 1 + n | ufrag の長さ + ufrag（ASCII） |
 * | … | 1 + n | pwd の長さ + pwd（ASCII） |
 * | … | 7 または 19 ずつ | ICE 候補（フラグ1 + アドレス4/16 + ポート2）を0個以上 |
 *
 * 候補のフラグ: bit0-1 アドレス種別 / bit2 プロトコル（0=UDP, 1=TCP） /
 * bit3 種類（0=host, 1=srflx） / bit4-5 TCP 接続方式
 */

import { addressSize, decodeAddress, encodeAddress } from './address';
import { base45Decode, base45Encode } from './base45';
import {
	FINGERPRINT_SIZE,
	HEADER_SIZE,
	MAGIC_BYTE,
	MAX_CREDENTIAL_LENGTH,
	PACKET_VERSION,
	PORT_SIZE,
	VERSION_MASK
} from './constants';
import { PacketDecodeError, PacketEncodeError } from './errors';
import type { SignalCandidate, SignalPacket, TcpType } from './types';

/** ICE の ufrag / pwd に使える文字（RFC 8839 の ice-char） */
const ICE_CHARS = /^[A-Za-z0-9+/]+$/;

const TCP_TYPES: readonly TcpType[] = ['passive', 'active', 'so'];

/**
 * ufrag / pwd として安全な文字列かどうかを判定する
 *
 * 改行などが混ざると SDP に余計な行を差し込まれてしまうため、必ず検査する。
 */
export function isValidIceCredential(value: string): boolean {
	return value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH && ICE_CHARS.test(value);
}

/**
 * パケットをバイト列にする
 *
 * @param packet フィンガープリント・ICE 認証情報・候補
 * @returns バイト列
 * @throws {@link PacketEncodeError} 入力値が不正な場合
 */
export function encodePacket(packet: Omit<SignalPacket, 'version'>): Uint8Array {
	const { fingerprint, ufrag, pwd, candidates } = packet;

	if (fingerprint.length !== FINGERPRINT_SIZE) {
		throw new PacketEncodeError(
			`フィンガープリントの長さが不正です（期待: ${FINGERPRINT_SIZE}、実際: ${fingerprint.length}）`
		);
	}
	if (!isValidIceCredential(ufrag) || !isValidIceCredential(pwd)) {
		throw new PacketEncodeError('ICE の認証情報に使えない文字が含まれています');
	}

	const parts: number[] = [MAGIC_BYTE, PACKET_VERSION, ...fingerprint];
	for (const credential of [ufrag, pwd]) {
		parts.push(credential.length);
		for (let i = 0; i < credential.length; i++) parts.push(credential.charCodeAt(i));
	}
	for (const candidate of candidates) {
		parts.push(...encodeCandidate(candidate));
	}
	return Uint8Array.from(parts);
}

/** 候補1件をバイト列にする */
function encodeCandidate(candidate: SignalCandidate): number[] {
	const address = encodeAddress(candidate.address);
	if (!address) {
		throw new PacketEncodeError(`パケットに入れられないアドレスです: ${candidate.address}`);
	}
	if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 0xffff) {
		throw new PacketEncodeError(`ポート番号が不正です: ${candidate.port}`);
	}

	let flags: number = address.family;
	if (candidate.protocol === 'tcp') {
		flags |= 1 << 2;
		flags |= Math.max(0, TCP_TYPES.indexOf(candidate.tcpType ?? 'passive')) << 4;
	}
	if (candidate.kind === 'srflx') flags |= 1 << 3;

	return [flags, ...address.bytes, candidate.port >> 8, candidate.port & 0xff];
}

/**
 * バイト列をパケットに戻す
 *
 * @param data バイト列
 * @returns パケット
 * @throws {@link PacketDecodeError} CHARMS のパケットではない、または壊れている場合
 */
export function decodePacket(data: Uint8Array): SignalPacket {
	if (data.length < HEADER_SIZE || data[0] !== MAGIC_BYTE) {
		throw new PacketDecodeError('CHARMS の QR コードではありません');
	}

	const version = data[1] & VERSION_MASK;
	if (version !== PACKET_VERSION) {
		throw new PacketDecodeError(
			`対応していないバージョンの QR コードです（バージョン ${version}）。両方の端末でアプリを最新にしてください`
		);
	}

	let offset = HEADER_SIZE;
	const take = (size: number): Uint8Array => {
		if (offset + size > data.length) {
			throw new PacketDecodeError('QR コードの内容が途中で切れています');
		}
		const slice = data.slice(offset, offset + size);
		offset += size;
		return slice;
	};

	const fingerprint = take(FINGERPRINT_SIZE);

	const readCredential = (): string => {
		const length = take(1)[0];
		const value = String.fromCharCode(...take(length));
		if (!isValidIceCredential(value)) {
			throw new PacketDecodeError('QR コードの内容が壊れています');
		}
		return value;
	};
	const ufrag = readCredential();
	const pwd = readCredential();

	const candidates: SignalCandidate[] = [];
	while (offset < data.length) {
		const flags = take(1)[0];
		const family = flags & 0b11;
		const size = addressSize(family);
		if (size === null) {
			throw new PacketDecodeError('QR コードの内容が壊れています');
		}
		const address = decodeAddress(family, take(size));
		const portBytes = take(PORT_SIZE);
		const port = (portBytes[0] << 8) | portBytes[1];
		if (address === null || port === 0) {
			throw new PacketDecodeError('QR コードの内容が壊れています');
		}

		const candidate: SignalCandidate = {
			address,
			port,
			kind: (flags >> 3) & 1 ? 'srflx' : 'host',
			protocol: (flags >> 2) & 1 ? 'tcp' : 'udp'
		};
		if (candidate.protocol === 'tcp') {
			candidate.tcpType = TCP_TYPES[(flags >> 4) & 0b11] ?? 'passive';
		}
		candidates.push(candidate);
	}

	return { version, fingerprint, ufrag, pwd, candidates };
}

/**
 * パケットを QR コードに入れる文字列にする
 *
 * QR の英数字モードで効率よく入る Base45 を使う。
 */
export function packetToQrText(packet: Omit<SignalPacket, 'version'>): string {
	return base45Encode(encodePacket(packet));
}

/**
 * QR コードから読み取った文字列をパケットに戻す
 *
 * @throws {@link PacketDecodeError} CHARMS の QR ではない、または壊れている場合
 */
export function packetFromQrText(text: string): SignalPacket {
	return decodePacket(base45Decode(text.trim()));
}
