/**
 * 映像を切り替える操作の共通インターフェース
 *
 * ホストとスイッチャーは同じ切り替え画面を使う。
 * ホストは自分で処理し、スイッチャーはホストに依頼する、という違いだけを吸収する。
 */

import type {
	CameraCommand,
	CueTarget,
	Layout,
	MonitorCommand,
	MonitorTarget,
	SessionSnapshot
} from './protocol';

export interface SwitcherApi {
	/** いまの状況（端末の一覧、各モニターに映している映像、設定） */
	readonly snapshot: SessionSnapshot;
	/** 映像入力ごとの、確認用の小さな映像 */
	readonly thumbnails: Record<string, MediaStream>;
	/** モニターの本番または予告に、映像を選ぶ */
	route(monitors: MonitorTarget, stage: 'program' | 'preview', sourceId: string | null): void;
	/** 予告の映像を本番に出す */
	take(monitors: MonitorTarget): void;
	/** モニターの画面の作り方（ワイプ・2画面・テロップ重ね）と、重ねる映像を選ぶ */
	setLayout(monitors: MonitorTarget, layout: Layout, sub: string | null): void;
	/** 端末の名前を変える */
	rename(id: string, name: string): void;
	/** カメラを遠隔操作する */
	cameraControl(targetId: string, command: CameraCommand): void;
	/** モニターを遠隔操作する */
	monitorControl(targetId: string, command: MonitorCommand): void;
	/** カメラ・テロップの担当者の画面に、指示を表示する */
	sendCue(targets: CueTarget, text: string): void;
	/** 全端末の録画を、まとめて始める・止める（ホストが録画を許可しているときだけ） */
	recordAll(on: boolean): void;
}
