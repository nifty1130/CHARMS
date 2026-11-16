/**
 * QRシグナリングのエラークラス
 *
 * `instanceof` で種類を判別できるように階層化している。
 * 画面に出す文言は `message` をそのまま使える日本語にしてある。
 */

import type { LinkState } from './types';

/** すべてのシグナリングエラーの親クラス */
export class SignalError extends Error {
	override name = 'SignalError';
}

/** パケットを作れなかったとき（入力値が不正） */
export class PacketEncodeError extends SignalError {
	override name = 'PacketEncodeError';
}

/** パケットを読めなかったとき（CHARMS の QR ではない、途中で切れている など） */
export class PacketDecodeError extends SignalError {
	override name = 'PacketDecodeError';
}

/** 接続の確立に失敗したとき */
export class LinkError extends SignalError {
	override name = 'LinkError';

	/**
	 * @param message エラーメッセージ
	 * @param state エラー発生時の接続状態
	 */
	constructor(
		message: string,
		public readonly state?: LinkState
	) {
		super(message);
	}
}

/** 時間内に接続できなかったとき */
export class LinkTimeoutError extends LinkError {
	override name = 'LinkTimeoutError';

	constructor(state?: LinkState) {
		super('時間内に接続できませんでした', state);
	}
}

/** 自分自身の QR を読み取ったとき */
export class SelfConnectionError extends LinkError {
	override name = 'SelfConnectionError';

	constructor(state?: LinkState) {
		super('自分の QR コードは読み取れません。相手の端末の QR を読み取ってください', state);
	}
}
