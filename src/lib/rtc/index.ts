/**
 * QR コードによる WebRTC 接続（シグナリングサーバー不要）
 *
 * 通常は {@link PeerLink} だけを使えばよい。
 */

export { PeerLink } from './link';
export { base45Decode, base45Encode } from './base45';
export { decodePacket, encodePacket, packetFromQrText, packetToQrText } from './packet';
export { compareFingerprints, formatFingerprint, generateVerificationCode } from './fingerprint';
export {
	LinkError,
	LinkTimeoutError,
	PacketDecodeError,
	PacketEncodeError,
	SelfConnectionError,
	SignalError
} from './errors';
export { QR_ERROR_CORRECTION_LEVEL } from './constants';
export type {
	CandidateKind,
	CandidateProtocol,
	LinkState,
	PeerLinkOptions,
	SignalCandidate,
	SignalPacket,
	TcpType
} from './types';
