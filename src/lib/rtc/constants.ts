/**
 * QWBPプロトコル定数
 */

/** QWBPパケットを識別するためのマジックパケット */
export const MAGIC_BYTE = 0x51; // 'Q'を意味するASCIIコード

/** QWBPプロトコルのバージョン */
export const PROTOCOL_VERSION = 0;

/** DTLSフィンガープリントのサイズ (バイト単位、SHA-256) */
export const FINGERPRINT_SIZE = 32;

/** パケットヘッダーのサイズ（バイト単位、マジックバイト + バージョン） */
export const HEADER_SIZE = 2;

/** 最小パケットサイズ（ヘッダー + フィンガープリント + IPv4候補1つ分） */
export const MIN_PACKET_SIZE = HEADER_SIZE + FINGERPRINT_SIZE + 7;

/** IPv4候補のサイズ（フラグ + IP + ポート） */
export const IPV4_CANDIDATE_SIZE = 1 + 4 + 2; // 7 bytes

/** IPv6/mDNS候補のサイズ（フラグ + IP/UUID + ポート） */
export const IPV6_CANDIDATE_SIZE = 1 + 16 + 2; // 19 bytes

/** ufrag（ユーザーフラグメント）生成用HKDF情報文字列 */
export const HKDF_INFO_UFRAG = 'QWBP-ICE-UFRAG-v1';

/** パスワード生成用HKDF情報文字列 */
export const HKDF_INFO_PWD = 'QWBP-ICE-PWD-v1';

/** ufragの出力長（Base64urlで6文字生成) */
export const HKDF_UFRAG_LENGTH = 4;

/** パスワードの出力長（Base64urlで24文字を生成） */
export const HKDF_PWD_LENGTH = 18; //Base64（およびBase64url）エンコードでは、3バイトのデータが4文字のテキストに変換される。
/** 含める候補数のデフォルト最大値 */
export const DEFAULT_MAX_CANDIDATES = 4;

/** ICE候補の優先度（RFC 8445） */
export const CANDIDATE_PRIORITIES = {
  HOST_UDP: 2122260223,
  HOST_TCP: 2105524223,
  SRFLX: 1686052607,
} as const;

/**
 * 推奨されるQRコード誤り訂正レベル
 *
 * レベルL（7%の復元能力）がQWBPに最適な理由:
 * - 画面表示のQRコードはコントラストが完璧で、物理的な損傷がないため
 * - 高いレベル（M=15%, Q=25%, H=30%）はQRコードのサイズやバージョンを増加させるため
 * - レベルHを使用するとv4コードがv5-6に上がってしまい、最適化の努力が無駄になるため
 */
export const QR_ERROR_CORRECTION_LEVEL = 'L' as const;
