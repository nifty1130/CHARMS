/**
 * STUNサーバ指定
*/
/**export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
*/
/**
 * タイムアウト指定
 */
export const DEFAULT_TIMEOUT = 30000;

/**
 * 接続における優先度の指定
 */
export const CANDIDATE_PRIORITIES = {
  HOST_UDP: 2122260223,
  HOST_TCP: 2105524223,
  SRFLX: 1686052607,
} as const;

