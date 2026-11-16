/**
 * シグナリング情報の型定義
 */

/**
 * ICE Candidateのアドレス定義
*/
export enum AddressFamily {
  IPv4 = 0b00,
  IPv6 = 0b01,
  mDNS = 0b10,
}

/** 
 * トランスポート層のプロトコルの定義
 */
export enum Protocol {
  TCP = 0b00,
  UDP = 0b01,
}

/**
 * ICE Candidateの種類の定義
 */
export enum CandidateType {
  Host = 0b00,
  ServerReflexive = 0b01,
}


/**
 * TCP Candidateの接続方式の定義
 */
export enum TcpType {
  Active = 0b00,
  Passive = 0b01,
  SimultaneousOpen = 0b10,
}

/**
 * Role in WebRTC connection (determined by fingerprint comparison)
 */
export enum Role {
  Offerer = 'offerer',
  Answerer = 'answerer',
}

/**
 * 接続状況の定義
 */
export enum ConnectionState {
  Idle = '初期状態',
  Gathering = 'ICE Candidateの収集中',
  Displaying = 'QRコード表示中',
  ScannedOne = 'Offerのみスキャン完了',
  Connecting = 'WebRTC接続試行中',
  Connected = 'DataChannel確立済み',
  Failed = '接続失敗',
  Closed = '接続終了',
}


/**
 * Represents an ICE candidate in QWBP format
 */
export interface QWBPCandidate {
  /** IP address or mDNS hostname */
  ip: string;

  /** Port number (1-65535) */
  port: number;

  /** Candidate type: host or server-reflexive */
  type: 'local' | 'srflx';

  /** Transport protocol */
  protocol: 'udp' | 'tcp';

  /** TCP type (only for TCP candidates) */
  tcpType?: 'passive' | 'active' | 'so';
}

/**
 * Decoded QWBP packet
 */
export interface QWBPPacket {
  /** Protocol version (currently 0) */
  version: number;

  /** 32-byte DTLS fingerprint */
  fingerprint: Uint8Array;

  /** ICE candidates */
  candidates: QWBPCandidate[];
}

/**
 * ICE credentials derived via HKDF
 */
export interface IceCredentials {
  /** ICE username fragment (6 chars) */
  ufrag: string;

  /** ICE password (24 chars) */
  pwd: string;
}

/**
 * Peer information after QR scan
 */
export interface PeerInfo {
  /** 32-byte DTLS fingerprint */
  fingerprint: Uint8Array;

  /** ICE candidates */
  candidates: QWBPCandidate[];

  /** Derived ICE credentials */
  credentials: IceCredentials;
}

/**
 * Configuration options for QWBPConnection
 */
export interface QWBPOptions {
  /** ICE servers for STUN/TURN */
  iceServers?: RTCIceServer[];

  /** Maximum number of candidates to include (default: 4) */
  maxCandidates?: number;

  /** Session timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Callback when state changes */
  onStateChange?: (state: ConnectionState) => void;

  /** Callback when DataChannel is ready */
  onDataChannel?: (channel: RTCDataChannel) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * Result of SDP reconstruction
 */
export interface ReconstructedSDP {
  /** The SDP string */
  sdp: string;

  /** SDP type: offer or answer */
  type: RTCSdpType;
}

