/**
 * SDP の読み取りと組み立て
 *
 * SDP はブラウザ同士が接続条件を伝え合うための長いテキスト。
 * そのままでは QR に入らないので、端末ごとに変わる部分（フィンガープリント・
 * ICE 認証情報・候補）だけを取り出して送り、受け取った側で SDP を組み立て直す。
 *
 * 自分側の SDP は一切書き換えない。組み立てるのは「相手側の SDP」だけ。
 */

import { addressRank } from './address';
import { CANDIDATE_PRIORITIES } from './constants';
import { formatFingerprint, parseFingerprint } from './fingerprint';
import { isValidIceCredential } from './packet';
import type { CandidateKind, SignalCandidate, SignalPacket, TcpType } from './types';

/** ブラウザが作った SDP から取り出した情報 */
export interface LocalDescriptionInfo {
	fingerprint: Uint8Array;
	ufrag: string;
	pwd: string;
	/** メディアセクションの識別子（通常は "0"） */
	mid: string;
	candidates: SignalCandidate[];
}

/**
 * SDP の `a=candidate:` 行（または candidate 文字列）を読み取る
 *
 * @param line `candidate:...` または `a=candidate:...`
 * @returns 候補。読み取れない、またはパケットに入れられない場合は null
 */
export function parseCandidateLine(line: string): SignalCandidate | null {
	const match =
		/^(?:a=)?candidate:\S+ (\d+) (\S+) \d+ (\S+) (\d+) typ (\S+)(.*)$/i.exec(line.trim());
	if (!match) return null;

	const [, component, protocolRaw, address, portRaw, kind, rest] = match;
	const protocol = protocolRaw.toLowerCase();
	const port = Number(portRaw);

	// コンポーネント 1（RTP）だけを使う。BUNDLE + rtcp-mux なので 2 は不要
	if (component !== '1') return null;
	if (protocol !== 'udp' && protocol !== 'tcp') return null;
	if (kind !== 'host' && kind !== 'srflx' && kind !== 'relay') return null;
	if (port < 1 || port > 0xffff) return null;
	if (addressRank(address) === null) return null;

	const candidate: SignalCandidate = { address, port, kind, protocol };
	if (protocol === 'tcp') {
		const tcpType = / tcptype (\S+)/i.exec(rest)?.[1].toLowerCase();
		candidate.tcpType = (['passive', 'active', 'so'] as TcpType[]).find((t) => t === tcpType);
	}
	return candidate;
}

/**
 * QR に入れる候補を選ぶ
 *
 * UDP だけに絞り、種類ごとに枠を分けて上限数まで残す。
 *
 * - `relay`（中継）と `srflx`（ルーターの外側）は、それぞれ1つあれば役目を果たすので1枠ずつ
 * - 残りの枠は `host`（端末自身）に、つながりやすい順（IPv4 → mDNS → IPv6）で割り当てる
 * - 枠が余ったら、選ばなかった候補で埋める
 *
 * 仮想ネットワークアダプタ（Hyper-V、Docker など）の候補も混ざるが、
 * ICE が全候補を試して届くものを自動で選ぶので、ここでは絞り込まない。
 *
 * @param candidates 収集した候補
 * @param max 残す数の上限
 * @returns 選んだ候補（host → srflx → relay の順）
 */
export function selectCandidates(candidates: SignalCandidate[], max: number): SignalCandidate[] {
	const seen = new Set<string>();
	const ranked = candidates
		.filter((c) => c.protocol === 'udp')
		.filter((c) => {
			const key = `${c.address}:${c.port}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.map((candidate, index) => ({ candidate, index, rank: addressRank(candidate.address) ?? 99 }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.candidate);

	const ofKind = (kind: CandidateKind) => ranked.filter((c) => c.kind === kind);
	const hosts = ofKind('host');
	const reserved = [...ofKind('srflx').slice(0, 1), ...ofKind('relay').slice(0, 1)].slice(0, max);

	const chosen = new Set<SignalCandidate>([...hosts.slice(0, max - reserved.length), ...reserved]);
	for (const candidate of ranked) {
		if (chosen.size >= max) break;
		chosen.add(candidate);
	}

	const order: Record<CandidateKind, number> = { host: 0, srflx: 1, relay: 2 };
	// sort は安定なので、同じ種類の中ではつながりやすい順が保たれる
	return ranked.filter((c) => chosen.has(c)).sort((a, b) => order[a.kind] - order[b.kind]);
}

/**
 * ブラウザが作った SDP から、QR で送る情報を取り出す
 *
 * @param sdp `pc.localDescription.sdp`（候補の収集が終わったもの）
 * @returns 取り出した情報。必要な行が見つからないときは null
 */
export function parseLocalDescription(sdp: string): LocalDescriptionInfo | null {
	const fingerprintText = /^a=fingerprint:sha-256 (\S+)/im.exec(sdp)?.[1];
	const ufrag = /^a=ice-ufrag:(\S+)/m.exec(sdp)?.[1];
	const pwd = /^a=ice-pwd:(\S+)/m.exec(sdp)?.[1];
	const mid = /^a=mid:(\S+)/m.exec(sdp)?.[1];
	if (!fingerprintText || !ufrag || !pwd || mid === undefined) return null;

	const fingerprint = parseFingerprint(fingerprintText);
	if (!fingerprint) return null;

	const candidates = sdp
		.split(/\r?\n/)
		.filter((line) => line.startsWith('a=candidate:'))
		.map(parseCandidateLine)
		.filter((c): c is SignalCandidate => c !== null);

	return { fingerprint, ufrag, pwd, mid, candidates };
}

/**
 * 相手の情報から、相手側の SDP（Answer）を組み立てる
 *
 * 両方の端末が Offer を作った状態で、互いに「相手は Answer を返した」ことにして
 * 接続する。こうすると、どちらが先に QR を読んでもよく、自分側の SDP も書き換えずに済む。
 *
 * @param remote 相手のパケット
 * @param setup 相手の DTLS の役割（`active`: 相手がクライアント / `passive`: 相手がサーバー）
 * @param mid 自分側の SDP のメディアセクション識別子
 * @returns `setRemoteDescription` に渡す SDP
 */
export function buildRemoteAnswer(
	remote: Pick<SignalPacket, 'fingerprint' | 'ufrag' | 'pwd'>,
	setup: 'active' | 'passive',
	mid: string
): string {
	// 外から来た値を SDP に埋め込むので、余計な行を差し込まれないよう検査する
	if (!isValidIceCredential(remote.ufrag) || !isValidIceCredential(remote.pwd)) {
		throw new Error('ICE の認証情報が不正です');
	}
	if (!/^[A-Za-z0-9_-]+$/.test(mid)) {
		throw new Error('mid が不正です');
	}

	// RFC 4566: 各行は最後の行も含めて CRLF で終える
	return (
		[
			'v=0',
			'o=- 1 2 IN IP4 127.0.0.1',
			's=-',
			't=0 0',
			`a=group:BUNDLE ${mid}`,
			'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
			'c=IN IP4 0.0.0.0',
			`a=ice-ufrag:${remote.ufrag}`,
			`a=ice-pwd:${remote.pwd}`,
			`a=fingerprint:sha-256 ${formatFingerprint(remote.fingerprint)}`,
			`a=setup:${setup}`,
			`a=mid:${mid}`,
			'a=sctp-port:5000',
			'a=max-message-size:262144'
		].join('\r\n') + '\r\n'
	);
}

/**
 * 候補を `addIceCandidate` に渡せる形にする
 *
 * @param candidate 候補
 * @param index 何番目の候補か（foundation に使う）
 * @param mid 自分側の SDP のメディアセクション識別子
 */
export function buildCandidateInit(
	candidate: SignalCandidate,
	index: number,
	mid: string
): RTCIceCandidateInit {
	const priority =
		candidate.kind === 'relay'
			? CANDIDATE_PRIORITIES.RELAY
			: candidate.kind === 'srflx'
				? CANDIDATE_PRIORITIES.SRFLX
				: candidate.protocol === 'udp'
					? CANDIDATE_PRIORITIES.HOST_UDP
					: CANDIDATE_PRIORITIES.HOST_TCP;

	// 同じ優先度だと順序が不定になるので、パケット内の順に少しずつ下げる
	let line = `candidate:${index + 1} 1 ${candidate.protocol} ${priority - index} ${candidate.address} ${candidate.port} typ ${candidate.kind}`;
	if (candidate.kind !== 'host') {
		// 元のアドレスは送っていないので、ダミーとして同じ値を入れる（ブラウザが必須とするため）
		line += ` raddr ${candidate.address} rport ${candidate.port}`;
	}
	if (candidate.protocol === 'tcp') {
		line += ` tcptype ${candidate.tcpType ?? 'passive'}`;
	}
	return { candidate: line, sdpMid: mid };
}
