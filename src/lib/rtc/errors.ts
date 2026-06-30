/**
 * QWBP エラークラス
 *
 * プログラムによるエラーハンドリングのためのエラー型階層を提供。
 *
 * @category Errors
 * @packageDocumentation
 */

import { ConnectionState } from './types.js';

/**
 * すべての QWBP エラーはこのクラスを継承します。
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * try {
 *   await connection.initialize();
 * } catch (error) {
 *   if (error instanceof QWBPError) {
 *     console.log('QWBP error:', error.message);
 *   }
 * }
 * ```
 */
export class QWBPError extends Error {
  override name = 'QWBPError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * QWBPパケットのエンコードに失敗した時に発生するエラー
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * try {
 *   const packet = encode(fingerprint, candidates);
 * } catch (error) {
 *   if (error instanceof QWBPEncodeError) {
 *     console.log('Invalid input for encoding:', error.message);
 *   }
 * }
 * ```
 */
export class QWBPEncodeError extends QWBPError {
  override name = 'QWBPEncodeError';
}

/**
 * QWBPパケットのデコードに失敗した時に発生するエラー
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * try {
 *   const packet = decode(data);
 * } catch (error) {
 *   if (error instanceof QWBPDecodeError) {
 *     console.log('Invalid packet:', error.message);
 *   }
 * }
 * ```
 */
export class QWBPDecodeError extends QWBPError {
  override name = 'QWBPDecodeError';
}

/**
 * WebRTC接続の確立に失敗した時に発生するエラー
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * connection.onError((error) => {
 *   if (error instanceof QWBPConnectionError) {
 *     console.log('接続失敗:', error.message);
 *     if (error.state) {
 *       console.log('State when error occurred:', error.state);
 *     }
 *   }
 * });
 * ```
 */
export class QWBPConnectionError extends QWBPError {
  override name = 'QWBPConnectionError';

  /**
   * @param message - エラーメッセージ
   * @param state - エラー発生時の接続状態
   */
  constructor(
    message: string,
    public readonly state?: ConnectionState | string
  ) {
    super(message);
  }
}

/**
 * 接続がタイムアウトした時に発生するエラー
 *
 * 設定されたタイムアウト期間（デフォルト：30秒）以内に接続が確立されなかった場合に発生します。
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * connection.onError((error) => {
 *   if (error instanceof QWBPTimeoutError) {
 *     console.log('Connection timed out - try again');
 *   }
 * });
 * ```
 */
export class QWBPTimeoutError extends QWBPConnectionError {
  override name = 'QWBPTimeoutError';

  constructor(state?: string) {
    super('セッションがタイムアウトしました', state);
  }
}

/**
 * ICE接続が失敗した時に発生するエラー
 *
 * ネットワーク制限やNATトラバーサルの問題により、WebRTCのICEネゴシエーションが失敗した場合に発生します。
 *
 * @category Errors
 *
 * @example
 * ```typescript
 * connection.onError((error) => {
 *   if (error instanceof QWBPIceError) {
 *     console.log('Network issue:', error.iceState);
 *   }
 * });
 * ```
 */
export class QWBPIceError extends QWBPConnectionError {
  override name = 'QWBPIceError';

  /**
   * @param iceState - エラーを引き起こしたICE接続状態
   * @param connectionState - エラー発生時の接続状態
   */
  constructor(
    public readonly iceState: string,
    connectionState?: string
  ) {
    super(`ICE connection ${iceState}`, connectionState);
  }
}
