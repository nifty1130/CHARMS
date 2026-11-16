/**
 * QRシグナリングの型定義
 */

/** アドレスの種類（パケットのフラグ bit0-1） */
export const AddressFamily = {
	IPv4: 0b00,
	IPv6: 0b01,
	Mdns: 0b10
} as const;

/** トランスポート層のプロトコル */
export type CandidateProtocol = 'udp' | 'tcp';

/** ICE 候補の種類（host: 端末自身のアドレス / srflx: STUN で得た外側のアドレス） */
export type CandidateKind = 'host' | 'srflx';

/** TCP 候補の接続方式 */
export type TcpType = 'passive' | 'active' | 'so';

/** パケットに入れる ICE 候補1件 */
export interface SignalCandidate {
	/** IPv4 / IPv6 アドレス、または mDNS ホスト名（`<uuid>.local`） */
	address: string;
	/** ポート番号（1〜65535） */
	port: number;
	kind: CandidateKind;
	protocol: CandidateProtocol;
	/** TCP 候補のときだけ使う */
	tcpType?: TcpType;
}

/** QR コードで交換する情報のすべて */
export interface SignalPacket {
	/** パケットのバージョン */
	version: number;
	/** DTLS フィンガープリント（32バイト） */
	fingerprint: Uint8Array;
	/** ICE ユーザー名フラグメント */
	ufrag: string;
	/** ICE パスワード */
	pwd: string;
	/** ICE 候補 */
	candidates: SignalCandidate[];
}

/**
 * 接続の進み具合
 *
 * - `idle`: まだ何もしていない
 * - `gathering`: 自分の接続情報を集めている
 * - `ready`: 自分の QR を表示できる。相手の QR を待っている
 * - `connecting`: 相手の QR を受け取り、接続を試みている
 * - `connected`: DataChannel が開通した
 * - `failed`: 接続できなかった
 * - `closed`: 接続を終了した
 */
export type LinkState =
	| 'idle'
	| 'gathering'
	| 'ready'
	| 'connecting'
	| 'connected'
	| 'failed'
	| 'closed';

/** PeerLink の設定 */
export interface PeerLinkOptions {
	/** パケットに含める候補数の上限（既定: 4） */
	maxCandidates?: number;
	/** 相手の情報を受け取ってから開通するまでの待ち時間（ミリ秒）。0 で無制限（既定: 0） */
	connectTimeoutMs?: number;
	/** RTCPeerConnection に渡す追加設定（LAN 専用なので既定では STUN/TURN なし） */
	rtcConfig?: RTCConfiguration;
	/** 状態が変わったとき */
	onStateChange?: (state: LinkState) => void;
	/** DataChannel が開通したとき */
	onOpen?: (channel: RTCDataChannel) => void;
	/** メッセージを受信したとき */
	onMessage?: (data: string | ArrayBuffer) => void;
	/** エラーが起きたとき */
	onError?: (error: Error) => void;
}
