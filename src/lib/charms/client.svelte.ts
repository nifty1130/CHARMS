/**
 * ClientSession — ホスト以外の端末（カメラ・テロップ・モニター・スイッチャー）の本体
 *
 * ホストと1本の DataChannel でつながり、状況の受信と、映像接続の打ち合わせを行う。
 *
 * ホストとつなぐ方法は2つある:
 *
 * - QR コードを読み取り合う（インターネットがなくても使える）
 * - 合言葉・招待リンクで、ルームを通してつなぐ（インターネットが必要）。
 *   こちらは、接続が切れたりページを読み込み直したりしても、自動でつなぎ直す
 */

import { cachedIceServers } from './ice';
import { MediaLinks } from './media-links';
import { Pairing } from './pairing.svelte';
import {
	ROLE_DEFAULTS,
	emptySnapshot,
	parseMessage,
	type ByeReason,
	type CameraCommand,
	type ClientMessage,
	type HostMessage,
	type MonitorTarget,
	type NodeInfo,
	type NodeRole,
	type QualityId,
	type ResumeInfo,
	type SessionSnapshot,
	type SourceKind
} from './protocol';
import { normalizeRoomCode, RoomSocket, type RoomMessage } from './room';
import type { SwitcherApi } from './switcher-api';

/** ホストに知らせる、自分の端末の状態 */
export interface NodeStatus {
	live?: boolean;
	recording?: boolean;
	quality?: QualityId;
	sourceKind?: SourceKind;
	canFlip?: boolean;
}

/**
 * 合言葉でつなぐ手続きの進み具合
 *
 * - `idle`: 何もしていない
 * - `connecting`: ルームにつなごうとしている
 * - `waiting`: ルームにはつながったが、ホストがまだいない（ホストが開くのを待っている）
 * - `joining`: ホストとつなごうとしている
 * - `offline`: ルームに届かない（インターネットがない、など）。自動で試し直している
 * - `full`: ルームが満員で入れない
 */
export type JoinState = 'idle' | 'connecting' | 'waiting' | 'joining' | 'offline' | 'full';

const NAME_KEY = 'charms:name:';
const RESUME_KEY = 'charms:resume:';
/** つなぎ直しの情報を覚えておく時間 */
const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** 申し込んでから、つながるまで待つ時間。過ぎたら最初からやり直す */
const OFFER_TIMEOUT_MS = 15_000;

interface StoredResume extends ResumeInfo {
	room: string | null;
	at: number;
}

function loadName(role: NodeRole): string {
	try {
		return localStorage.getItem(NAME_KEY + role) ?? '';
	} catch {
		return '';
	}
}

function saveName(role: NodeRole, name: string): void {
	try {
		localStorage.setItem(NAME_KEY + role, name);
	} catch {
		// 保存できない環境（プライベートブラウズなど）では、覚えないだけで動作は続ける
	}
}

// つなぎ直しの情報は「このタブ」にだけ覚えさせる（sessionStorage）。
// 同じ端末で同じ役割を2つのタブで開いても、別々の端末として扱える。
function loadResume(role: NodeRole): StoredResume | null {
	try {
		const value: unknown = JSON.parse(sessionStorage.getItem(RESUME_KEY + role) ?? 'null');
		if (typeof value !== 'object' || value === null) return null;
		const { id, token, room, at } = value as Record<string, unknown>;
		if (typeof id !== 'string' || typeof token !== 'string' || typeof at !== 'number') return null;
		if (Date.now() - at > RESUME_MAX_AGE_MS) return null;
		return { id, token, room: typeof room === 'string' ? room : null, at };
	} catch {
		return null;
	}
}

function saveResume(role: NodeRole, resume: StoredResume | null): void {
	try {
		if (resume) sessionStorage.setItem(RESUME_KEY + role, JSON.stringify(resume));
		else sessionStorage.removeItem(RESUME_KEY + role);
	} catch {
		// 保存できない環境では、自動でつなぎ直せないだけで動作は続ける
	}
}

export class ClientSession implements SwitcherApi {
	readonly role: NodeRole;

	/** ホストとつながっているか */
	connected = $state(false);
	/** 一度つながったあとで、接続が切れたか */
	lost = $state(false);
	/** ホストの側から接続を終えられた理由（自動ではつなぎ直さない） */
	ended = $state<ByeReason | null>(null);
	/** ホストから割り当てられた ID（例: cam1） */
	id = $state('');
	/** この端末の名前 */
	name = $state('');
	/** いまの状況 */
	snapshot = $state.raw<SessionSnapshot>(emptySnapshot());
	/** 受信中の映像（送り元の ID ごと） */
	streams = $state.raw<Record<string, MediaStream>>({});
	/** 映像を送っている相手の ID */
	targets = $state.raw<string[]>([]);
	/** ホストとつなぐための手続き */
	pairing = $state.raw<Pairing>(this.#createPairing());
	/** つなぎ先のルームの合言葉（分かっていれば、切れたときに自動でつなぎ直す） */
	room = $state<string | null>(null);
	/** 合言葉でつなぐ手続きの進み具合 */
	joinState = $state<JoinState>('idle');

	/** スイッチャーから遠隔操作されたとき（カメラ・テロップ用） */
	onCameraCommand: ((command: CameraCommand) => void) | null = null;

	readonly media: MediaLinks;
	#status: NodeStatus = {};
	#destroyed = false;
	#resume: ResumeInfo | null = null;
	#socket: RoomSocket | null = null;
	#offerTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(role: NodeRole) {
		this.role = role;
		this.name = loadName(role);
		this.media = new MediaLinks({
			iceServers: cachedIceServers,
			sendSignal: (toId, description) => this.#send({ type: 'signal', toId, description }),
			onStreams: (streams) => {
				this.streams = streams;
			},
			onTargets: (targets) => {
				this.targets = targets;
			},
			onFailed: (sourceId, sinkId) => {
				if (!this.id) return;
				this.#send({
					type: 'link_failed',
					sourceId: sourceId ?? this.id,
					sinkId: sinkId ?? this.id
				});
			}
		});
	}

	/** スイッチャーの画面に並べる確認用映像（SwitcherApi） */
	get thumbnails(): Record<string, MediaStream> {
		return this.streams;
	}

	/** この端末自身の情報 */
	get self(): NodeInfo | undefined {
		return this.snapshot.nodes.find((node) => node.id === this.id);
	}

	/** 名前の初期値（「カメラ」など） */
	get roleLabel(): string {
		return ROLE_DEFAULTS[this.role].label;
	}

	// ---- 合言葉・招待リンクでつなぐ ----

	/**
	 * ページを開いたときに、自動でつなぐものがあればつなぐ
	 *
	 * - 招待リンク（`?room=合言葉`）から開いたとき
	 * - つながっていたページを読み込み直したとき（前と同じ端末として戻る）
	 *
	 * @param roomFromUrl リンクに付いていた合言葉
	 */
	autoJoin(roomFromUrl: string | null): void {
		const stored = loadResume(this.role);
		const fromUrl = normalizeRoomCode(roomFromUrl);

		// 別の合言葉のリンクから開いたときは、前の催しの情報は使わない
		if (stored && (!fromUrl || stored.room === fromUrl)) {
			this.#resume = { id: stored.id, token: stored.token };
		}
		const code = fromUrl ?? stored?.room ?? null;
		if (code) this.joinRoom(code);
	}

	/**
	 * 合言葉でホストにつなぐ
	 *
	 * つながるまで、自動で試し続ける（ホストがまだ開いていなければ待つ）。
	 *
	 * @param code 合言葉（6桁の数字）
	 * @returns 合言葉の形式が正しければ true
	 */
	joinRoom(code: string): boolean {
		const normalized = normalizeRoomCode(code);
		if (!normalized || this.#destroyed) return false;

		this.#closeSocket();
		this.room = normalized;
		this.ended = null;
		if (this.connected) return true;

		this.joinState = 'connecting';
		const socket = new RoomSocket({
			code: normalized,
			as: 'node',
			onStatus: (status) => {
				if (this.#socket !== socket) return;
				if (status === 'refused') this.joinState = 'full';
				else if (status !== 'open') this.joinState = status;
			},
			onMessage: (message) => {
				if (this.#socket === socket) void this.#onRoomMessage(message);
			}
		});
		this.#socket = socket;
		return true;
	}

	/** 合言葉でつなぐのをやめる（QR コードでつなぐときなど） */
	cancelJoin(): void {
		this.#closeSocket();
		this.room = null;
		this.#persistResume();
	}

	// ---- 操作 ----

	route(monitors: MonitorTarget, stage: 'program' | 'preview', sourceId: string | null): void {
		this.#send({ type: 'route', monitors, stage, sourceId });
	}

	take(monitors: MonitorTarget): void {
		this.#send({ type: 'take', monitors });
	}

	rename(id: string, name: string): void {
		if (id === this.id) {
			saveName(this.role, name.trim());
		}
		this.#send({ type: 'rename', id, name });
	}

	cameraControl(targetId: string, command: CameraCommand): void {
		this.#send({ type: 'camera_control', targetId, command });
	}

	/** 自分の状態（映像を出せるか、録画中か など）をホストに知らせる */
	setStatus(status: NodeStatus): void {
		this.#status = { ...this.#status, ...status };
		this.#send({ type: 'status', ...status });
	}

	/** ホストとつなぐ手続きを最初からやり直す */
	restartPairing(): void {
		const previous = this.pairing;
		this.pairing = this.#createPairing();
		previous.close();
	}

	/** 終了する */
	destroy(): void {
		this.#destroyed = true;
		this.#closeSocket();
		this.pairing.close();
		this.media.closeAll();
	}

	// ---- 内部処理 ----

	#createPairing(): Pairing {
		return new Pairing({
			onOpen: (pairing) => {
				pairing.send({
					type: 'register',
					role: this.role,
					name: this.name || undefined,
					// 前につながっていた端末なら、同じ ID・名前・映像の割り当てに戻してもらう
					resume: this.#resume ?? undefined
				} satisfies ClientMessage);
			},
			onMessage: (data, pairing) => {
				if (pairing === this.pairing) this.#onMessage(data);
			},
			onEnd: (pairing) => {
				if (pairing === this.pairing) this.#onEnd();
			}
		});
	}

	#send(message: ClientMessage): void {
		this.pairing.send(message);
	}

	#persistResume(): void {
		saveResume(
			this.role,
			this.#resume ? { ...this.#resume, room: this.room, at: Date.now() } : null
		);
	}

	#onMessage(data: unknown): void {
		const message = parseMessage<HostMessage>(data);
		if (!message) return;

		switch (message.type) {
			case 'registered':
				// 以前の接続の映像が残っていれば、ここで片付けて最初からやり直す
				this.media.closeAll();
				this.snapshot = emptySnapshot();
				this.id = message.id;
				this.name = message.name;
				this.connected = true;
				this.lost = false;
				this.ended = null;
				this.#closeSocket();
				if (typeof message.token === 'string') {
					this.#resume = { id: message.id, token: message.token };
					this.#persistResume();
				}
				// つなぎ直したときのために、いまの状態をあらためて知らせる
				if (Object.keys(this.#status).length > 0) {
					this.#send({ type: 'status', ...this.#status });
				}
				break;

			case 'snapshot': {
				this.snapshot = message.snapshot;
				const self = message.snapshot.nodes.find((node) => node.id === this.id);
				if (self && self.name !== this.name) {
					this.name = self.name;
					saveName(this.role, self.name);
				}
				// ホストがルームを開いていれば、合言葉を覚えておく（切れたときの自動つなぎ直し用）
				const room = message.snapshot.room;
				if (room !== undefined && (room ?? null) !== this.room) {
					this.room = room ?? null;
					this.#persistResume();
				}
				break;
			}

			case 'bye':
				// ホストの側から終えられたときは、自動ではつなぎ直さない
				this.ended = message.reason === 'replaced' ? 'replaced' : 'removed';
				this.#resume = null;
				this.room = null;
				this.#persistResume();
				this.#closeSocket();
				break;

			case 'make_offer':
				void this.media.offerTo(message.targetId, message.profile);
				break;

			case 'drop_link':
				this.media.drop(message.peerId);
				break;

			case 'signal':
				void this.media.handleSignal(message.fromId, message.description);
				break;

			case 'camera_control':
				this.onCameraCommand?.(message.command);
				break;
		}
	}

	/**
	 * ホストとの接続が切れた
	 *
	 * 映像は端末同士が直接送り合っているので、ここでは切らない。
	 * ホストが落ちても、モニターにはいまの映像が出続ける（切り替えだけができなくなる）。
	 * 合言葉が分かっていれば、ルーム経由で自動でつなぎ直す。
	 */
	#onEnd(): void {
		this.connected = false;
		if (this.#destroyed) {
			this.media.closeAll();
			return;
		}
		this.lost = true;
		this.pairing = this.#createPairing();
		if (this.room && !this.ended) this.joinRoom(this.room);
	}

	// ---- ルームとのやり取り ----

	#closeSocket(): void {
		clearTimeout(this.#offerTimer);
		this.#socket?.close();
		this.#socket = null;
		this.joinState = 'idle';
	}

	async #onRoomMessage(message: RoomMessage): Promise<void> {
		switch (message.type) {
			case 'host':
				if (message.present) {
					void this.#offer();
				} else {
					clearTimeout(this.#offerTimer);
					this.joinState = 'waiting';
				}
				break;

			case 'answer':
				// ホストの接続情報が届いた。QR を読み取ったのと同じ扱いで受け取る
				if (!(await this.pairing.accept(message.packet))) this.#offerLater(1500);
				break;

			case 'reject':
				this.#offerLater(message.reason === 'busy' ? 2000 : 4000);
				break;
		}
	}

	/** 自分の接続情報をホストに届ける（QR を見せるのと同じ） */
	async #offer(): Promise<void> {
		clearTimeout(this.#offerTimer);
		const socket = this.#socket;
		if (!socket || this.connected) return;
		this.joinState = 'joining';

		// 前の申し込みが途中で止まっていたら、新しい接続情報で最初からやり直す
		if (!['idle', 'gathering', 'ready'].includes(this.pairing.state)) this.restartPairing();
		const pairing = this.pairing;
		await pairing.start();
		if (socket !== this.#socket || this.connected) return;
		if (pairing !== this.pairing || !pairing.qrText) {
			this.#offerLater(2000);
			return;
		}

		socket.send({ type: 'offer', packet: pairing.qrText });
		this.#offerLater(OFFER_TIMEOUT_MS);
	}

	#offerLater(delayMs: number): void {
		clearTimeout(this.#offerTimer);
		this.#offerTimer = setTimeout(() => void this.#offer(), delayMs);
	}
}
