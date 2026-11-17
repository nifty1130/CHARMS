/**
 * CHARMS の通信プロトコル
 *
 * すべての端末は「ホスト」と DataChannel でつながり、ここで定義したメッセージを
 * JSON でやり取りする。映像は端末同士が直接送り合う（ホストは取り次ぎだけ）。
 */

/** ホスト以外の役割 */
export type NodeRole = 'camera' | 'admin' | 'monitor' | 'controller';

/** すべての役割 */
export type RoleId = 'host' | NodeRole;

/** ホスト自身を指す ID */
export const HOST_ID = 'host';

/** 映像の画質 */
export type QualityId = 'low' | 'medium' | 'high';

/** 映像入力の種類 */
export type SourceKind = 'webcam' | 'screen' | 'text';

/**
 * 音声の送り方
 *
 * - `voice`: 会話向け（雑音を抑える）
 * - `music`: 音楽向け（加工をせず、高音質・ステレオ）
 */
export type AudioMode = 'voice' | 'music';

/**
 * 映像の送り方
 *
 * - `thumbnail`: ホストやスイッチャーの画面に並べる小さな確認用映像（低画質・音声なし）
 * - `program`: モニターに映す本番用の映像（選んだ画質・音声あり）
 * - `talk`: インカム。スイッチャーの声を、カメラ担当に届ける（音声のみ）
 */
export type LinkProfile = 'thumbnail' | 'program' | 'talk';

/**
 * モニターの画面の作り方
 *
 * - `single`: 1つの映像を画面いっぱいに映す
 * - `pip`: 本番の映像の隅に、もう1つの映像を小さく重ねる（ワイプ）
 * - `split`: 2つの映像を左右に並べる
 * - `overlay`: 本番の映像の上に、もう1つの映像の明るい部分だけを重ねる（テロップ用。黒い部分は透ける）
 */
export type Layout = 'single' | 'pip' | 'split' | 'overlay';

export const LAYOUTS: Layout[] = ['single', 'pip', 'split', 'overlay'];

/** カメラのズームできる範囲と、いまの値 */
export interface ZoomInfo {
	min: number;
	max: number;
	step: number;
	value: number;
}

/**
 * 通信の状態のまとめ
 *
 * - `relay`: 中継サーバー（TURN）を通っている映像接続があるか
 * - `quality`: いちばん状態の悪い映像接続の評価
 */
export interface NetInfo {
	relay: boolean;
	quality: 'good' | 'fair' | 'poor';
}

/** ホストにつながっている端末1台の情報 */
export interface NodeInfo {
	/** ホストが割り当てる番号つきの ID（例: cam1）。つながっている間は変わらない */
	id: string;
	role: NodeRole;
	/** 画面に表示する名前（変更できる） */
	name: string;
	/** 映像を送り出せる状態か（カメラ・テロップのみ意味を持つ） */
	live: boolean;
	/** 録画中か */
	recording: boolean;
	/** 現在の画質（カメラ・テロップのみ） */
	quality?: QualityId;
	/** 映像入力の種類（カメラ・テロップのみ） */
	sourceKind?: SourceKind;
	/** 別のカメラに切り替えられるか（カメラが2つ以上ある端末） */
	canFlip?: boolean;
	/** 音声を送っているか（マイクのない端末やテロップでは false） */
	hasAudio?: boolean;
	/** マイクを消音しているか（カメラのみ） */
	muted?: boolean;
	/** 音声の送り方（カメラのみ） */
	audioMode?: AudioMode;
	/** 音を出しているか（モニターのみ） */
	sound?: boolean;
	/** ズームできるカメラなら、その範囲といまの値 */
	zoom?: ZoomInfo;
	/** ライトを点けられるカメラなら、いま点いているか（点けられない端末では省略） */
	torch?: boolean;
	/** 通信の状態（映像接続があるときだけ） */
	net?: NetInfo;
	/** インカムで話しているか（スイッチャーのみ） */
	talking?: boolean;
	/** インカムを聞く設定にしているか（カメラのみ） */
	listening?: boolean;
}

/**
 * モニター1台に何を映すか
 *
 * - `program`: いま映している映像（本番）
 * - `preview`: 次に映す予定の映像（予告）。あらかじめ接続しておくので、切り替えが一瞬で済む
 */
export interface Route {
	monitorId: string;
	program: string | null;
	preview: string | null;
	/** 画面の作り方（省略時は `single`） */
	layout?: Layout;
	/** 重ねる・並べる、もう1つの映像（`single` 以外のときに使う） */
	sub?: string | null;
}

/** 全体の設定（ホストが決める） */
export interface SessionSettings {
	/** 録画を許可するか。許可しないと、どの端末にも録画ボタンが出ない */
	allowRecording: boolean;
}

/** ホストが全端末に配る「いまの状況」 */
export interface SessionSnapshot {
	nodes: NodeInfo[];
	routes: Route[];
	settings: SessionSettings;
	/**
	 * ホストが開いているルームの合言葉（開いていなければ null）
	 *
	 * 端末はこれを覚えておき、ホストとの接続が切れたときに、ルーム経由で自動でつなぎ直す。
	 */
	room?: string | null;
}

/** スイッチャーからカメラへの遠隔操作 */
export type CameraCommand =
	| { action: 'quality'; quality: QualityId }
	| { action: 'flip' }
	| { action: 'mute'; muted: boolean }
	| { action: 'audio_mode'; mode: AudioMode }
	| { action: 'zoom'; value: number }
	| { action: 'torch'; on: boolean }
	| { action: 'record'; on: boolean };

/** スイッチャーからモニターへの遠隔操作 */
export type MonitorCommand = { action: 'sound'; on: boolean } | { action: 'record'; on: boolean };

/** 指示メッセージの送り先。`'all'` は全部のカメラ・テロップ */
export type CueTarget = string[] | 'all';

/** 指示メッセージの最大文字数 */
export const MAX_CUE_LENGTH = 60;

/** 指示メッセージの文を整える（前後の空白を除き、長すぎる場合は切り詰める） */
export function cleanCue(text: unknown): string {
	if (typeof text !== 'string') return '';
	return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CUE_LENGTH);
}

/** 切り替えの対象にするモニター。`'all'` は全モニター */
export type MonitorTarget = string[] | 'all';

/**
 * つなぎ直すときに「前と同じ端末です」と名乗るための情報
 *
 * `token` は、最初につながったときにホストから渡される合図。
 * 合っていれば、ホストは同じ ID と名前を割り当て直し、映していた映像も元に戻す。
 */
export interface ResumeInfo {
	id: string;
	token: string;
}

/** ホストが端末との接続を終える理由（`replaced`: 同じ端末が別の画面でつなぎ直した / `removed`: ホストが切断した） */
export type ByeReason = 'replaced' | 'removed';

/** 端末 → ホスト */
export type ClientMessage =
	| { type: 'register'; role: NodeRole; name?: string; resume?: ResumeInfo }
	| { type: 'rename'; id: string; name: string }
	| {
			type: 'status';
			live?: boolean;
			recording?: boolean;
			quality?: QualityId;
			sourceKind?: SourceKind;
			canFlip?: boolean;
			hasAudio?: boolean;
			muted?: boolean;
			audioMode?: AudioMode;
			sound?: boolean;
			zoom?: ZoomInfo | null;
			torch?: boolean | null;
			net?: NetInfo | null;
			talking?: boolean;
			listening?: boolean;
	  }
	| { type: 'route'; monitors: MonitorTarget; stage: 'program' | 'preview'; sourceId: string | null }
	| { type: 'take'; monitors: MonitorTarget }
	| { type: 'layout'; monitors: MonitorTarget; layout: Layout; sub: string | null }
	| { type: 'signal'; toId: string; description: RTCSessionDescriptionInit }
	| { type: 'link_failed'; sourceId: string; sinkId: string }
	| { type: 'camera_control'; targetId: string; command: CameraCommand }
	| { type: 'monitor_control'; targetId: string; command: MonitorCommand }
	| { type: 'cue'; targets: CueTarget; text: string }
	| { type: 'record_all'; on: boolean };

/** ホスト → 端末 */
export type HostMessage =
	| { type: 'registered'; id: string; name: string; token: string }
	| { type: 'bye'; reason: ByeReason }
	| { type: 'snapshot'; snapshot: SessionSnapshot }
	| { type: 'make_offer'; targetId: string; profile: LinkProfile }
	| { type: 'drop_link'; peerId: string }
	| { type: 'signal'; fromId: string; description: RTCSessionDescriptionInit }
	| { type: 'camera_control'; command: CameraCommand }
	| { type: 'monitor_control'; command: MonitorCommand }
	| { type: 'cue'; from: string; text: string };

/** 役割ごとの ID の頭文字と、名前の初期値 */
export const ROLE_DEFAULTS: Record<NodeRole, { prefix: string; label: string }> = {
	camera: { prefix: 'cam', label: 'カメラ' },
	admin: { prefix: 'adm', label: 'テロップ' },
	monitor: { prefix: 'mon', label: 'モニター' },
	controller: { prefix: 'ctrl', label: 'スイッチャー' }
};

/** 名前の最大文字数 */
export const MAX_NAME_LENGTH = 24;

/** 映像を送り出す役割か */
export function isSourceRole(role: NodeRole): boolean {
	return role === 'camera' || role === 'admin';
}

/** 空の状況（つながる前の初期値） */
export function emptySnapshot(): SessionSnapshot {
	return { nodes: [], routes: [], settings: { allowRecording: false } };
}

/**
 * 受信した文字列をメッセージとして読み取る
 *
 * @returns メッセージ。JSON として読めない、または `type` がない場合は null
 */
export function parseMessage<T extends { type: string }>(data: unknown): T | null {
	if (typeof data !== 'string') return null;
	try {
		const value: unknown = JSON.parse(data);
		if (typeof value === 'object' && value !== null && typeof (value as T).type === 'string') {
			return value as T;
		}
	} catch {
		// 読めないメッセージは無視する
	}
	return null;
}

/** 名前を表示用に整える（前後の空白を除き、長すぎる場合は切り詰める） */
export function cleanName(name: unknown, fallback: string): string {
	if (typeof name !== 'string') return fallback;
	const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
	return trimmed || fallback;
}
