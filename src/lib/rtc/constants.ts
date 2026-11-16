/**
 * QRシグナリングパケットの定数
 *
 * パケット形式は QWBP (QR-WebRTC Bootstrap Protocol) をベースにしつつ、
 * ICE の ufrag / pwd をパケットに同梱する CHARMS 独自版（バージョン 1）。
 * ブラウザが生成した SDP を書き換えずに済むため、SDP 書き換え規制の影響を受けない。
 */

/** パケットを識別するためのマジックバイト（ASCII の 'Q'） */
export const MAGIC_BYTE = 0x51;

/** パケットのバージョン（0 は本家 QWBP。CHARMS 版は 1） */
export const PACKET_VERSION = 1;

/** バージョン番号が入っているビット（2バイト目の下位3ビット） */
export const VERSION_MASK = 0b111;

/** ヘッダーのサイズ（マジックバイト + バージョン） */
export const HEADER_SIZE = 2;

/** DTLS フィンガープリントのサイズ（SHA-256 = 32バイト） */
export const FINGERPRINT_SIZE = 32;

/** ufrag / pwd の最大長（RFC 8839: ufrag は 4〜256文字、pwd は 22〜256文字。長さを1バイトで持つので 255 まで） */
export const MAX_CREDENTIAL_LENGTH = 255;

/** IPv4 アドレスのバイト数 */
export const IPV4_SIZE = 4;

/** IPv6 アドレス / mDNS の UUID のバイト数 */
export const IPV6_SIZE = 16;

/** ポート番号のバイト数（ビッグエンディアン） */
export const PORT_SIZE = 2;

/** パケットに含める候補数の既定の上限 */
export const DEFAULT_MAX_CANDIDATES = 4;

/** 相手の情報を受け取ってから DataChannel が開くまでの既定の待ち時間（ミリ秒）。0 で無制限 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 0;

/** ICE 候補の収集を待つ最大時間（ミリ秒） */
export const GATHERING_TIMEOUT_MS = 10_000;

/** DataChannel のラベル */
export const CHANNEL_LABEL = 'charms';

/** DataChannel の ID（両端で同じ値を使う negotiated チャネル） */
export const CHANNEL_ID = 0;

/** ICE 候補の優先度（RFC 8445 の推奨式による代表値） */
export const CANDIDATE_PRIORITIES = {
	HOST_UDP: 2122260223,
	HOST_TCP: 2105524223,
	SRFLX: 1686052607
} as const;

/**
 * 推奨する QR コードの誤り訂正レベル
 *
 * 画面に表示した QR は汚れや欠けがないため、最も低い L（7%）で十分。
 * レベルを上げると QR が細かくなり、かえって読み取りにくくなる。
 */
export const QR_ERROR_CORRECTION_LEVEL = 'L' as const;
