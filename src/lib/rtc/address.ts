/**
 * ICE 候補のアドレスとバイト列の相互変換
 *
 * - IPv4: 4バイト
 * - IPv6: 16バイト
 * - mDNS: ブラウザが IP を隠すために使う `<uuid>.local`。UUID 部分を16バイトにする
 */

import ipaddr from 'ipaddr.js';
import { IPV4_SIZE, IPV6_SIZE } from './constants';
import { AddressFamily } from './types';

type Family = (typeof AddressFamily)[keyof typeof AddressFamily];

const MDNS_UUID = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

/** アドレスをバイト列にしたもの */
export interface EncodedAddress {
	family: Family;
	bytes: Uint8Array;
}

/**
 * アドレス文字列をバイト列に変換する
 *
 * @param address IPv4 / IPv6 / mDNS のアドレス
 * @returns 変換結果。パケットに入れられない形式のときは null
 */
export function encodeAddress(address: string): EncodedAddress | null {
	if (ipaddr.IPv4.isValidFourPartDecimal(address)) {
		return {
			family: AddressFamily.IPv4,
			bytes: Uint8Array.from(ipaddr.IPv4.parse(address).toByteArray())
		};
	}

	const mdns = MDNS_UUID.exec(address);
	if (mdns) {
		const hex = mdns.slice(1).join('');
		const bytes = new Uint8Array(IPV6_SIZE);
		for (let i = 0; i < IPV6_SIZE; i++) {
			bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return { family: AddressFamily.Mdns, bytes };
	}

	// ゾーン ID 付き（fe80::1%eth0 など）は他の端末から使えないので対象外
	if (!address.includes('%') && ipaddr.IPv6.isValid(address)) {
		return {
			family: AddressFamily.IPv6,
			bytes: Uint8Array.from(ipaddr.IPv6.parse(address).toByteArray())
		};
	}

	return null;
}

/**
 * バイト列をアドレス文字列に戻す
 *
 * @param family アドレスの種類
 * @param bytes アドレスのバイト列
 * @returns アドレス文字列。種類が不明なときは null
 */
export function decodeAddress(family: number, bytes: Uint8Array): string | null {
	switch (family) {
		case AddressFamily.IPv4:
			return bytes.length === IPV4_SIZE ? Array.from(bytes).join('.') : null;

		case AddressFamily.IPv6:
			return bytes.length === IPV6_SIZE ? ipaddr.fromByteArray(Array.from(bytes)).toString() : null;

		case AddressFamily.Mdns: {
			if (bytes.length !== IPV6_SIZE) return null;
			const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
		}

		default:
			return null;
	}
}

/**
 * アドレスの種類ごとのバイト数を返す
 *
 * @param family アドレスの種類
 * @returns バイト数。種類が不明なときは null
 */
export function addressSize(family: number): number | null {
	switch (family) {
		case AddressFamily.IPv4:
			return IPV4_SIZE;
		case AddressFamily.IPv6:
		case AddressFamily.Mdns:
			return IPV6_SIZE;
		default:
			return null;
	}
}

/**
 * 候補を並べるときの優先順位を返す（小さいほど優先）
 *
 * 校内 LAN では IPv4 が最も確実につながるので最優先にする。
 * 他の端末から到達できないアドレス（IPv6 リンクローカルなど）は null を返して除外する。
 *
 * @param address アドレス文字列
 * @returns 優先順位。使えないアドレスは null
 */
export function addressRank(address: string): number | null {
	const encoded = encodeAddress(address);
	if (!encoded) return null;

	if (encoded.family === AddressFamily.Mdns) return 1;

	const range = ipaddr.parse(address).range();
	if (range === 'unspecified' || range === 'multicast' || range === 'broadcast') return null;
	if (range === 'loopback') return 3;

	if (encoded.family === AddressFamily.IPv4) return 0;

	// IPv6 リンクローカルはインターフェース指定が必要で、QR 越しには使えない
	if (range === 'linkLocal') return null;
	return 2;
}
