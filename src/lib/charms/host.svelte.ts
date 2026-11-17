/**
 * HostSession — ホスト（司令塔）の本体
 *
 * すべての端末とつながり、次の仕事をする:
 *
 * 1. 端末の登録と名前の管理
 * 2. 「どのモニターに何を映すか」の管理
 * 3. 端末同士が映像を直接送り合うための取り次ぎ
 *
 * ホスト自身は映像を中継しない（映像はカメラからモニターへ直接届く）。
 * そのため、ホストの端末が非力でも映像の品質には影響しない。
 *
 * 端末とつなぐ方法は2つある:
 *
 * - QR コードを読み取り合う（{@link HostSession.openInvite}。インターネットがなくても使える）
 * - 合言葉・招待リンク（{@link HostSession.openRoom}。インターネットが必要）
 *
 * 接続が切れた端末のことは覚えておき、戻ってきたら同じ ID・名前・映像の割り当てに戻す。
 * 状況を端末に保存しておけば（`persist`）、ホストのページを読み込み直しても続きから再開できる。
 */

import { cachedIceServers } from './ice';
import { LocalHostBeacon } from './local-pairing.svelte';
import { MediaLinks } from './media-links';
import { Pairing } from './pairing.svelte';
import {
	HOST_ID,
	ROLE_DEFAULTS,
	cleanName,
	emptySnapshot,
	isSourceRole,
	parseMessage,
	type ByeReason,
	type CameraCommand,
	type ClientMessage,
	type HostMessage,
	type MonitorTarget,
	type NodeInfo,
	type NodeRole,
	type ResumeInfo,
	type Route,
	type SessionSettings,
	type SessionSnapshot
} from './protocol';
import {
	generateRoomCode,
	generateSecret,
	normalizeRoomCode,
	RoomSocket,
	type RoomMessage,
	type RoomStatus
} from './room';
import { applyRoute, applyTake, desiredLinks, diffLinks, linkKey, syncRoutes } from './routing';
import type { SwitcherApi } from './switcher-api';

const NODE_ROLES: NodeRole[] = ['camera', 'admin', 'monitor', 'controller'];

/** 映像接続が失敗したとき、張り直すまでの待ち時間（失敗が続くほど長くする） */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;

/**
 * 映像を直接切り替えたとき、前の映像との接続を残しておく時間
 *
 * 新しい映像の絵が出るまで前の映像を映し続けられるので、切り替えの瞬間に黒い画面が挟まらない。
 */
const HANDOVER_MS = 2500;

/** ルームや同じ端末の別タブから申し込まれた接続が、つながるまで待つ時間 */
const JOIN_TIMEOUT_MS = 30_000;
/** 同時に受け付ける申し込みの数 */
const MAX_PENDING_JOINS = 8;
/** 接続を終える合図を送ってから、実際に切るまでの時間（合図が届くのを待つ） */
const BYE_DELAY_MS = 300;

/** 覚えておく「いなくなった端末」の数の上限 */
const MAX_REMEMBERED = 64;
const STORAGE_KEY = 'charms:host:v1';
/** 保存した状況から再開できる時間 */
const RESTORE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface NodeEntry {
	info: NodeInfo;
	pairing: Pairing;
	/** この端末が戻ってきたときに、本人だと確かめるための合図 */
	token: string;
}

/** 接続が切れたが、戻ってくるかもしれない端末 */
interface Remembered {
	info: NodeInfo;
	token: string;
}

/** 端末に保存する内容 */
interface SavedState {
	savedAt: number;
	room: { code: string; key: string; enabled: boolean } | null;
	counters: [NodeRole, number][];
	nodes: { id: string; role: NodeRole; name: string; token: string }[];
	routes: Route[];
	settings: SessionSettings;
}

/** 画面に出すお知らせ（「カメラ 1 がつながりました」など） */
export interface HostEvent {
	at: number;
	text: string;
}

/** ルーム（合言葉）の状況 */
export interface HostRoom {
	/** 合言葉 */
	code: string;
	status: RoomStatus;
	/** 断られた理由（`replaced`: 別の画面で同じホストが開かれた） */
	reason?: string;
}

export interface HostSessionOptions {
	/**
	 * 状況を端末に保存し、次に開いたときに続きから再開する（既定: しない）
	 *
	 * ホストのページを読み込み直しても、同じ合言葉・同じ端末の割り当てに戻れる。
	 */
	persist?: boolean;
}

export class HostSession implements SwitcherApi {
	/** いまの状況 */
	snapshot = $state.raw<SessionSnapshot>(emptySnapshot());
	/** 映像入力ごとの確認用映像 */
	thumbnails = $state.raw<Record<string, MediaStream>>({});
	/** 端末を追加するための、待ち受け中の手続き（QR コード） */
	invite = $state.raw<Pairing | null>(null);
	/** 合言葉・招待リンクでの受け付けの状況（受け付けていなければ null） */
	room = $state.raw<HostRoom | null>(null);
	/** 接続が切れていて、戻ってくるのを待っている端末 */
	absent = $state.raw<NodeInfo[]>([]);
	/** 保存してあった状況から再開したか */
	restored = $state(false);
	/** 合言葉での受け付けを、開いたときから始めてよいか（前回やめていたら false） */
	roomPreferred = true;
	/** 出来事の記録（新しいものが先頭） */
	events = $state.raw<HostEvent[]>([]);

	readonly #persist: boolean;
	readonly #nodes = new Map<string, NodeEntry>();
	readonly #remembered = new Map<string, Remembered>();
	/** ホストが自分で切断した端末（戻ってきても覚えていない扱いにする） */
	readonly #removing = new Set<string>();
	/** つながったが、まだ役割を名乗っていない端末 */
	readonly #pending = new Set<Pairing>();
	readonly #counters = new Map<NodeRole, number>();
	/** いま張っている（または張ろうとしている）映像接続 */
	readonly #links = new Set<string>();
	readonly #failures = new Map<string, number>();
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	/** 切り替えの直後で、まだ切らずに残している接続 */
	readonly #lingering = new Map<string, ReturnType<typeof setTimeout>>();
	/** 映したい内容（いまいない端末の分も含む。戻ってきたときに元に戻すため） */
	#routes: Route[] = [];
	#settings: SessionSettings = { allowRecording: false };
	#inviting = false;
	#destroyed = false;

	#roomCode: string | null = null;
	#roomKey: string | null = null;
	#roomEnabled = false;
	#roomSocket: RoomSocket | null = null;
	#joining = 0;

	readonly #media = new MediaLinks({
		iceServers: cachedIceServers,
		sendSignal: (toId, description) => this.#sendTo(toId, { type: 'signal', fromId: HOST_ID, description }),
		onStreams: (streams) => {
			this.thumbnails = streams;
		},
		onFailed: (sourceId) => {
			if (sourceId) this.#onLinkFailed(sourceId, HOST_ID);
		}
	});

	readonly #beacon = new LocalHostBeacon((qrText) => this.#acceptRemote(qrText));

	constructor(options: HostSessionOptions = {}) {
		this.#persist = options.persist ?? false;
		if (this.#persist) this.#restore();
	}

	// ---- 端末の追加（QR コード） ----

	/** 端末の追加を受け付け始める（QR を表示できるようにする） */
	openInvite(): void {
		this.#inviting = true;
		if (!this.invite) this.#renewInvite();
	}

	/** 端末の追加をやめる */
	closeInvite(): void {
		this.#inviting = false;
		this.invite?.close();
		this.invite = null;
	}

	/** 待ち受けをやり直す（QR を作り直す） */
	resetInvite(): void {
		this.invite?.close();
		this.invite = null;
		if (this.#inviting) this.#renewInvite();
	}

	#renewInvite(): void {
		this.invite = this.#createPairing();
	}

	#createPairing(): Pairing {
		return new Pairing({
			onOpen: (pairing) => {
				this.#pending.add(pairing);
				// 1台つながったら、すぐ次の端末を受け付けられるようにする
				if (this.invite === pairing) {
					this.invite = null;
					if (this.#inviting && !this.#destroyed) this.#renewInvite();
				}
			},
			onMessage: (data, pairing) => this.#onMessage(pairing, data),
			onEnd: (pairing) => this.#onEnd(pairing)
		});
	}

	/**
	 * QR を使わずに届いた接続情報（同じ端末の別タブ、またはルーム経由）を受け付ける
	 *
	 * @returns 相手に返す、ホスト側の接続情報。受け付けられなければ null
	 */
	async #acceptRemote(qrText: string): Promise<string | null> {
		if (this.#destroyed) return null;
		const pairing = this.#createPairing();
		await pairing.start();
		if (!pairing.qrText || !(await pairing.accept(qrText))) {
			pairing.close();
			return null;
		}
		// 相手が途中でいなくなった申し込みを、いつまでも残さない
		this.#later(JOIN_TIMEOUT_MS, () => {
			if (pairing.state !== 'connected') pairing.close();
		});
		return pairing.qrText;
	}

	// ---- 端末の追加（合言葉・招待リンク） ----

	/**
	 * 合言葉・招待リンクでの受け付けを始める
	 *
	 * インターネットにつながっていないときは `offline` になり、つながるまで自動で試し続ける。
	 */
	openRoom(): void {
		if (this.#destroyed) return;
		this.#roomEnabled = true;
		this.#roomCode ??= generateRoomCode();
		this.#roomKey ??= generateSecret();
		if (!this.#roomSocket) this.#connectRoom();
		this.#publish();
	}

	/** 合言葉・招待リンクでの受け付けをやめる（つながっている端末はそのまま） */
	closeRoom(): void {
		this.#roomEnabled = false;
		this.#roomSocket?.close();
		this.#roomSocket = null;
		this.room = null;
		this.#publish();
	}

	/** 合言葉を作り直す（知られたくない相手に知られたとき） */
	renewRoom(): void {
		this.#roomSocket?.close();
		this.#roomSocket = null;
		this.#roomCode = generateRoomCode();
		this.#roomKey = generateSecret();
		if (this.#roomEnabled) this.#connectRoom();
		this.#publish();
	}

	#connectRoom(): void {
		const code = this.#roomCode;
		const key = this.#roomKey;
		if (!code || !key || this.#destroyed) return;

		this.room = { code, status: 'connecting' };
		const socket = new RoomSocket({
			code,
			as: 'host',
			key,
			onStatus: (status, reason) => {
				if (this.#roomSocket !== socket) return;
				if (status === 'refused' && reason === 'taken') {
					// たまたま同じ合言葉を、ほかの人が使っていた。別の合言葉にする
					this.renewRoom();
					return;
				}
				this.room = { code, status, reason };
			},
			onMessage: (message) => {
				if (this.#roomSocket === socket) void this.#onRoomMessage(socket, message);
			}
		});
		this.#roomSocket = socket;
	}

	async #onRoomMessage(socket: RoomSocket, message: RoomMessage): Promise<void> {
		if (message.type !== 'join') return;
		const { peer, packet } = message;

		if (this.#joining >= MAX_PENDING_JOINS) {
			socket.send({ type: 'reject', peer, reason: 'busy' });
			return;
		}
		this.#joining++;
		try {
			const answer = await this.#acceptRemote(packet);
			socket.send(answer ? { type: 'answer', peer, packet: answer } : { type: 'reject', peer, reason: 'failed' });
		} finally {
			this.#joining--;
		}
	}

	// ---- 切り替えの操作（SwitcherApi） ----

	route(monitors: MonitorTarget, stage: 'program' | 'preview', sourceId: string | null): void {
		if (sourceId !== null && !isSourceRole(this.#nodes.get(sourceId)?.info.role ?? 'monitor')) return;
		this.#routes = applyRoute(this.#routes, monitors, stage, sourceId);
		this.#publish();
	}

	take(monitors: MonitorTarget): void {
		this.#routes = applyTake(this.#routes, monitors);
		this.#publish();
	}

	rename(id: string, name: string): void {
		const entry = this.#nodes.get(id);
		if (!entry) return;
		entry.info = { ...entry.info, name: cleanName(name, entry.info.name) };
		this.#publish();
	}

	cameraControl(targetId: string, command: CameraCommand): void {
		const entry = this.#nodes.get(targetId);
		if (!entry || !isSourceRole(entry.info.role)) return;
		entry.pairing.send({ type: 'camera_control', command } satisfies HostMessage);
	}

	// ---- ホストだけができる操作 ----

	/** 録画を許可するかどうかを切り替える */
	setAllowRecording(allow: boolean): void {
		this.#settings = { ...this.#settings, allowRecording: allow };
		this.#publish();
	}

	/** 端末を切断する（その端末は、自動ではつなぎ直さない） */
	disconnect(id: string): void {
		const entry = this.#nodes.get(id);
		if (!entry) return;
		this.#removing.add(id);
		this.#sayBye(entry.pairing, 'removed');
	}

	/** いなくなった端末を待つのをやめる（省略すると全部） */
	forget(id?: string): void {
		if (id === undefined) this.#remembered.clear();
		else this.#remembered.delete(id);
		this.#publish();
	}

	/** ホストを終了する（全端末との接続が切れる） */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#inviting = false;
		for (const timer of this.#timers) clearTimeout(timer);
		for (const timer of this.#lingering.values()) clearTimeout(timer);
		this.#beacon.close();
		this.#roomSocket?.close();
		this.#roomSocket = null;
		this.invite?.close();
		for (const pairing of this.#pending) pairing.close();
		for (const entry of [...this.#nodes.values()]) entry.pairing.close();
		this.#media.closeAll();
	}

	// ---- メッセージの処理 ----

	#onMessage(pairing: Pairing, data: unknown): void {
		const message = parseMessage<ClientMessage>(data);
		if (!message) return;

		if (message.type === 'register') {
			if (this.#pending.has(pairing)) {
				this.#register(pairing, message.role, message.name, message.resume);
			}
			return;
		}

		const entry = this.#entryOf(pairing);
		if (!entry) return;
		const { id } = entry.info;

		switch (message.type) {
			case 'rename':
				this.rename(typeof message.id === 'string' ? message.id : id, message.name);
				break;

			case 'status': {
				const info = { ...entry.info };
				if (typeof message.live === 'boolean') info.live = message.live;
				if (typeof message.recording === 'boolean') info.recording = message.recording;
				if (message.quality) info.quality = message.quality;
				if (message.sourceKind) info.sourceKind = message.sourceKind;
				if (typeof message.canFlip === 'boolean') info.canFlip = message.canFlip;
				entry.info = info;
				this.#publish();
				break;
			}

			case 'route':
				if (entry.info.role === 'controller') {
					this.route(message.monitors, message.stage, message.sourceId);
				}
				break;

			case 'take':
				if (entry.info.role === 'controller') this.take(message.monitors);
				break;

			case 'camera_control':
				if (entry.info.role === 'controller') {
					this.cameraControl(message.targetId, message.command);
				}
				break;

			case 'signal':
				// 実際に張ろうとしている接続の打ち合わせだけを取り次ぐ
				if (
					this.#links.has(linkKey(id, message.toId)) ||
					this.#links.has(linkKey(message.toId, id))
				) {
					this.#sendTo(message.toId, {
						type: 'signal',
						fromId: id,
						description: message.description
					});
				}
				break;

			case 'link_failed':
				if (message.sourceId === id || message.sinkId === id) {
					this.#onLinkFailed(message.sourceId, message.sinkId);
				}
				break;
		}
	}

	#register(pairing: Pairing, role: NodeRole, name: unknown, resume: unknown): void {
		if (!NODE_ROLES.includes(role)) return;
		this.#pending.delete(pairing);

		const returning = this.#takeBack(role, resume);
		let info: NodeInfo;
		let token: string;
		if (returning) {
			({ info, token } = returning);
		} else {
			const count = (this.#counters.get(role) ?? 0) + 1;
			this.#counters.set(role, count);
			const { prefix, label } = ROLE_DEFAULTS[role];
			info = {
				id: `${prefix}${count}`,
				role,
				name: cleanName(name, `${label} ${count}`),
				live: false,
				recording: false
			};
			token = generateSecret();
		}
		this.#nodes.set(info.id, { info, pairing, token });

		pairing.send({ type: 'registered', id: info.id, name: info.name, token } satisfies HostMessage);
		this.#log(returning ? `${info.name} がつなぎ直しました` : `${info.name} がつながりました`);
		this.#publish();
	}

	/**
	 * 前につながっていた端末が戻ってきたのなら、その端末の情報を取り出す
	 *
	 * 合図（token）が合っているときだけ、同じ端末とみなす。
	 */
	#takeBack(role: NodeRole, resume: unknown): Remembered | null {
		if (typeof resume !== 'object' || resume === null) return null;
		const { id, token } = resume as Partial<ResumeInfo>;
		if (typeof id !== 'string' || typeof token !== 'string') return null;

		// ホストがまだ切れたことに気づいていない端末が、先につなぎ直してきた
		const current = this.#nodes.get(id);
		if (current && current.token === token && current.info.role === role) {
			this.#nodes.delete(id);
			this.#sayBye(current.pairing, 'replaced');
			return { info: { ...current.info, live: false, recording: false }, token };
		}

		const past = this.#remembered.get(id);
		if (past && past.token === token && past.info.role === role) {
			this.#remembered.delete(id);
			return past;
		}
		return null;
	}

	/** 接続を終える理由を伝えてから切る */
	#sayBye(pairing: Pairing, reason: ByeReason): void {
		pairing.send({ type: 'bye', reason } satisfies HostMessage);
		this.#later(BYE_DELAY_MS, () => pairing.close());
	}

	#onEnd(pairing: Pairing): void {
		this.#pending.delete(pairing);
		const entry = this.#entryOf(pairing);
		if (!entry) return;
		const { id, name } = entry.info;
		this.#nodes.delete(id);

		if (!this.#removing.delete(id)) {
			// 戻ってきたときに同じ端末として扱えるよう、覚えておく
			this.#remembered.delete(id);
			this.#remembered.set(id, {
				info: { ...entry.info, live: false, recording: false },
				token: entry.token
			});
			for (const oldest of this.#remembered.keys()) {
				if (this.#remembered.size <= MAX_REMEMBERED) break;
				this.#remembered.delete(oldest);
			}
		}

		if (this.#destroyed) return;
		this.#log(`${name} との接続が切れました`);
		this.#publish();
	}

	#entryOf(pairing: Pairing): NodeEntry | undefined {
		for (const entry of this.#nodes.values()) {
			if (entry.pairing === pairing) return entry;
		}
		return undefined;
	}

	// ---- 状況の配布と、映像接続の調整 ----

	/** 状況をまとめ直して全端末に配り、必要な映像接続を張り直す */
	#publish(): void {
		if (this.#destroyed) return;
		const nodes = [...this.#nodes.values()].map((entry) => entry.info);
		const absent = [...this.#remembered.values()].map((entry) => entry.info);

		// 映したい内容は、いまいない端末の分も残しておく（戻ってきたら元どおりに映す）。
		// 端末に配るのは、いまいる端末だけに絞ったもの。
		this.#routes = syncRoutes(this.#routes, [...nodes, ...absent]);
		const snapshot: SessionSnapshot = {
			nodes,
			routes: syncRoutes(this.#routes, nodes),
			settings: this.#settings,
			room: this.#roomEnabled ? this.#roomCode : null
		};
		this.snapshot = snapshot;
		this.absent = absent;

		const message = JSON.stringify({ type: 'snapshot', snapshot } satisfies HostMessage);
		for (const entry of this.#nodes.values()) entry.pairing.link.send(message);

		this.#save();
		this.#reconcile();
	}

	/** 必要な映像接続と実際の接続を比べ、差分だけを各端末に指示する */
	#reconcile(): void {
		if (this.#destroyed) return;
		const desired = desiredLinks(this.snapshot.nodes, this.snapshot.routes);
		const { added, removed } = diffLinks(desired, this.#links);

		// 残しておいた接続が、また必要になった（すぐ元の映像に戻した、など）
		const wanted = new Set(desired.map((link) => linkKey(link.sourceId, link.sinkId)));
		for (const [key, timer] of this.#lingering) {
			if (!wanted.has(key)) continue;
			clearTimeout(timer);
			this.#lingering.delete(key);
		}

		for (const key of removed) {
			if (this.#lingering.has(key)) continue;
			if (this.#isHandover(key)) {
				// 新しい映像が出るまでの間、前の映像との接続を少しだけ残す
				const timer = setTimeout(() => {
					this.#lingering.delete(key);
					const stillWanted = desiredLinks(this.snapshot.nodes, this.snapshot.routes).some(
						(link) => linkKey(link.sourceId, link.sinkId) === key
					);
					if (!stillWanted) this.#dropLink(key);
				}, HANDOVER_MS);
				this.#lingering.set(key, timer);
				continue;
			}
			this.#dropLink(key);
		}
		for (const link of added) {
			this.#links.add(linkKey(link.sourceId, link.sinkId));
			this.#sendTo(link.sourceId, {
				type: 'make_offer',
				targetId: link.sinkId,
				profile: link.profile
			});
		}
	}

	/** 映像接続を切るよう、両方の端末に指示する */
	#dropLink(key: string): void {
		if (!this.#links.delete(key)) return;
		const [sourceId, sinkId] = key.split('>');
		this.#failures.delete(key);
		this.#sendTo(sourceId, { type: 'drop_link', peerId: sinkId });
		this.#sendTo(sinkId, { type: 'drop_link', peerId: sourceId });
	}

	/** モニターの映像を別の映像に切り替えたことで、不要になった接続かどうか */
	#isHandover(key: string): boolean {
		const [sourceId, sinkId] = key.split('>');
		if (!this.#nodes.has(sourceId) || this.#nodes.get(sinkId)?.info.role !== 'monitor') return false;
		const route = this.snapshot.routes.find((r) => r.monitorId === sinkId);
		return !!route?.program && route.program !== sourceId;
	}

	/** 映像接続が切れたときは、少し待ってから張り直す */
	#onLinkFailed(sourceId: string, sinkId: string): void {
		const key = linkKey(sourceId, sinkId);
		if (!this.#links.delete(key)) return;
		this.#sendTo(sourceId, { type: 'drop_link', peerId: sinkId });
		this.#sendTo(sinkId, { type: 'drop_link', peerId: sourceId });

		const failures = (this.#failures.get(key) ?? 0) + 1;
		this.#failures.set(key, failures);
		const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
		this.#later(delay, () => this.#reconcile());
	}

	/** 端末（またはホスト自身）にメッセージを届ける */
	#sendTo(id: string, message: HostMessage): void {
		if (id !== HOST_ID) {
			this.#nodes.get(id)?.pairing.send(message);
			return;
		}
		// ホスト自身は、確認用映像を受け取る側としてだけ振る舞う
		if (message.type === 'signal') {
			void this.#media.handleSignal(message.fromId, message.description);
		} else if (message.type === 'drop_link') {
			this.#media.drop(message.peerId);
		}
	}

	/** 少しあとで実行する（ホストを終了したら実行しない） */
	#later(delayMs: number, run: () => void): void {
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			run();
		}, delayMs);
		this.#timers.add(timer);
	}

	#log(text: string): void {
		this.events = [{ at: Date.now(), text }, ...this.events].slice(0, 50);
	}

	// ---- 保存と再開 ----

	#save(): void {
		if (!this.#persist) return;
		const state: SavedState = {
			savedAt: Date.now(),
			room:
				this.#roomCode && this.#roomKey
					? { code: this.#roomCode, key: this.#roomKey, enabled: this.#roomEnabled }
					: null,
			counters: [...this.#counters],
			nodes: [
				...[...this.#nodes.values()].map((entry) => ({ ...entry.info, token: entry.token })),
				...[...this.#remembered.values()].map((entry) => ({ ...entry.info, token: entry.token }))
			].map(({ id, role, name, token }) => ({ id, role, name, token })),
			routes: this.#routes,
			settings: this.#settings
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// 保存できない環境では、再開できないだけで動作は続ける
		}
	}

	/** 保存してあった状況を読み込む（つながっていた端末は「戻ってくるのを待っている端末」になる） */
	#restore(): void {
		let saved: Partial<SavedState> | null = null;
		try {
			saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SavedState> | null;
		} catch {
			return;
		}
		if (!saved || typeof saved.savedAt !== 'number') return;
		if (Date.now() - saved.savedAt > RESTORE_MAX_AGE_MS) return;

		try {
			const code = normalizeRoomCode(saved.room?.code);
			if (code && typeof saved.room?.key === 'string') {
				this.#roomCode = code;
				this.#roomKey = saved.room.key;
				this.roomPreferred = saved.room.enabled !== false;
			}
			for (const [role, count] of saved.counters ?? []) {
				if (NODE_ROLES.includes(role) && Number.isInteger(count)) this.#counters.set(role, count);
			}
			for (const node of saved.nodes ?? []) {
				if (!NODE_ROLES.includes(node.role) || typeof node.token !== 'string') continue;
				this.#remembered.set(node.id, {
					info: {
						id: node.id,
						role: node.role,
						name: cleanName(node.name, node.id),
						live: false,
						recording: false
					},
					token: node.token
				});
			}
			if (Array.isArray(saved.routes)) this.#routes = saved.routes;
			if (typeof saved.settings?.allowRecording === 'boolean') {
				this.#settings = { allowRecording: saved.settings.allowRecording };
			}
		} catch {
			// 保存内容が壊れていたら、読めた分だけで始める
		}

		this.restored = this.#remembered.size > 0;
		this.#publish();
	}
}
