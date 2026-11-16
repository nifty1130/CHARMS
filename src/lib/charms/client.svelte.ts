/**
 * ClientSession — ホスト以外の端末（カメラ・テロップ・モニター・スイッチャー）の本体
 *
 * ホストと1本の DataChannel でつながり、状況の受信と、映像接続の打ち合わせを行う。
 */

import { MediaLinks } from './media-links';
import { Pairing } from './pairing.svelte';
import {
	ROLE_DEFAULTS,
	emptySnapshot,
	parseMessage,
	type CameraCommand,
	type ClientMessage,
	type HostMessage,
	type MonitorTarget,
	type NodeInfo,
	type NodeRole,
	type QualityId,
	type SessionSnapshot,
	type SourceKind
} from './protocol';
import type { SwitcherApi } from './switcher-api';

/** ホストに知らせる、自分の端末の状態 */
export interface NodeStatus {
	live?: boolean;
	recording?: boolean;
	quality?: QualityId;
	sourceKind?: SourceKind;
	canFlip?: boolean;
}

const NAME_KEY = 'charms:name:';

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

export class ClientSession implements SwitcherApi {
	readonly role: NodeRole;

	/** ホストとつながっているか */
	connected = $state(false);
	/** 一度つながったあとで、接続が切れたか */
	lost = $state(false);
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

	/** スイッチャーから遠隔操作されたとき（カメラ・テロップ用） */
	onCameraCommand: ((command: CameraCommand) => void) | null = null;

	readonly media: MediaLinks;
	#status: NodeStatus = {};
	#destroyed = false;

	constructor(role: NodeRole) {
		this.role = role;
		this.name = loadName(role);
		this.media = new MediaLinks({
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
					name: this.name || undefined
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
				break;
			}

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
	 */
	#onEnd(): void {
		this.connected = false;
		if (this.#destroyed) {
			this.media.closeAll();
			return;
		}
		this.lost = true;
		this.pairing = this.#createPairing();
	}
}
