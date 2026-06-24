/**
 * シグナリング情報の型定義
 */

import { rollupVersion } from "vite"

/**
 * ICE Candidateのアドレス定義
*/
export enum AddressType {
  IPv4 = 0b00,
  IPv6 = 0b01,
  mDNS = 0b10,
}

/** 
 * トランスポート層のプロトコルの定義
 */
export enum ProtocolType {
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

