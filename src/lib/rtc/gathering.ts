/**
 * ICE 候補の収集待ち
 *
 * QR やホスト経由で接続情報を「まとめて1回」で渡すので、候補が出そろうまで待つ必要がある。
 * ただし STUN / TURN サーバーを使うと、届かない経路の時間切れを待って収集が長引くことがある。
 * 必要な候補がそろった時点で切り上げて、待ち時間を短くする。
 */

import {
	GATHERING_SETTLE_MS,
	GATHERING_TIMEOUT_MS,
	SERVER_GATHERING_TIMEOUT_MS
} from './constants';

export interface GatheringOptions {
	/** STUN / TURN サーバーを使っているか（既定: 接続の設定から判断する） */
	usesServers?: boolean;
	/** 待つ最大時間（ミリ秒） */
	timeoutMs?: number;
}

/** 接続の設定に STUN / TURN サーバーが含まれているか */
export function hasIceServers(pc: RTCPeerConnection): boolean {
	try {
		return (pc.getConfiguration().iceServers ?? []).length > 0;
	} catch {
		return false;
	}
}

/**
 * ICE 候補の収集が終わるまで待つ
 *
 * 次のどれかで先へ進む（集まった分は `pc.localDescription` に入っている）:
 *
 * - 収集が完了した
 * - 中継用（relay）の候補が届いてから少し経った（STUN / TURN を使うとき。
 *   relay が出ていれば、それより先に出る host / srflx はそろっている）
 * - 時間切れ
 */
export function waitForGathering(pc: RTCPeerConnection, options: GatheringOptions = {}): Promise<void> {
	if (pc.iceGatheringState === 'complete') return Promise.resolve();

	const usesServers = options.usesServers ?? hasIceServers(pc);
	const timeoutMs =
		options.timeoutMs ?? (usesServers ? SERVER_GATHERING_TIMEOUT_MS : GATHERING_TIMEOUT_MS);

	return new Promise((resolve) => {
		let settle: ReturnType<typeof setTimeout> | undefined;

		const done = () => {
			clearTimeout(timer);
			clearTimeout(settle);
			pc.removeEventListener('icegatheringstatechange', onChange);
			pc.removeEventListener('icecandidate', onCandidate);
			resolve();
		};
		const onChange = () => {
			if (pc.iceGatheringState === 'complete') done();
		};
		const onCandidate = (event: RTCPeerConnectionIceEvent) => {
			if (event.candidate?.type === 'relay' && settle === undefined) {
				settle = setTimeout(done, GATHERING_SETTLE_MS);
			}
		};

		const timer = setTimeout(done, timeoutMs);
		pc.addEventListener('icegatheringstatechange', onChange);
		if (usesServers) pc.addEventListener('icecandidate', onCandidate);
	});
}
