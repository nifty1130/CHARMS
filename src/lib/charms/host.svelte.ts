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
	type CameraCommand,
	type ClientMessage,
	type HostMessage,
	type MonitorTarget,
	type NodeInfo,
	type NodeRole,
	type Route,
	type SessionSettings,
	type SessionSnapshot
} from './protocol';
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

interface NodeEntry {
	info: NodeInfo;
	pairing: Pairing;
}

/** 画面に出すお知らせ（「カメラ 1 がつながりました」など） */
export interface HostEvent {
	at: number;
	text: string;
}

export class HostSession implements SwitcherApi {
	/** いまの状況 */
	snapshot = $state.raw<SessionSnapshot>(emptySnapshot());
	/** 映像入力ごとの確認用映像 */
	thumbnails = $state.raw<Record<string, MediaStream>>({});
	/** 端末を追加するための、待ち受け中の手続き */
	invite = $state.raw<Pairing | null>(null);
	/** 出来事の記録（新しいものが先頭） */
	events = $state.raw<HostEvent[]>([]);

	readonly #nodes = new Map<string, NodeEntry>();
	/** つながったが、まだ役割を名乗っていない端末 */
	readonly #pending = new Set<Pairing>();
	readonly #counters = new Map<NodeRole, number>();
	/** いま張っている（または張ろうとしている）映像接続 */
	readonly #links = new Set<string>();
	readonly #failures = new Map<string, number>();
	readonly #retryTimers = new Set<ReturnType<typeof setTimeout>>();
	/** 切り替えの直後で、まだ切らずに残している接続 */
	readonly #lingering = new Map<string, ReturnType<typeof setTimeout>>();
	#routes: Route[] = [];
	#settings: SessionSettings = { allowRecording: false };
	#inviting = false;
	#destroyed = false;

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

	readonly #beacon = new LocalHostBeacon((qrText) => this.#acceptLocal(qrText));

	// ---- 端末の追加 ----

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

	/** 同じ端末の別タブからの接続を受け付ける */
	async #acceptLocal(qrText: string): Promise<string | null> {
		if (this.#destroyed) return null;
		const pairing = this.#createPairing();
		await pairing.start();
		if (!pairing.qrText || !(await pairing.accept(qrText))) {
			pairing.close();
			return null;
		}
		return pairing.qrText;
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

	/** 端末を切断する */
	disconnect(id: string): void {
		this.#nodes.get(id)?.pairing.close();
	}

	/** ホストを終了する（全端末との接続が切れる） */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#inviting = false;
		for (const timer of this.#retryTimers) clearTimeout(timer);
		for (const timer of this.#lingering.values()) clearTimeout(timer);
		this.#beacon.close();
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
			if (this.#pending.has(pairing)) this.#register(pairing, message.role, message.name);
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

	#register(pairing: Pairing, role: NodeRole, name: unknown): void {
		if (!NODE_ROLES.includes(role)) return;
		this.#pending.delete(pairing);

		const count = (this.#counters.get(role) ?? 0) + 1;
		this.#counters.set(role, count);
		const { prefix, label } = ROLE_DEFAULTS[role];
		const info: NodeInfo = {
			id: `${prefix}${count}`,
			role,
			name: cleanName(name, `${label} ${count}`),
			live: false,
			recording: false
		};
		this.#nodes.set(info.id, { info, pairing });

		pairing.send({ type: 'registered', id: info.id, name: info.name } satisfies HostMessage);
		this.#log(`${info.name} がつながりました`);
		this.#publish();
	}

	#onEnd(pairing: Pairing): void {
		this.#pending.delete(pairing);
		const entry = this.#entryOf(pairing);
		if (!entry) return;
		this.#nodes.delete(entry.info.id);
		if (this.#destroyed) return;
		this.#log(`${entry.info.name} との接続が切れました`);
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
		const nodes = [...this.#nodes.values()].map((entry) => entry.info);
		this.#routes = syncRoutes(this.#routes, nodes);
		const snapshot: SessionSnapshot = { nodes, routes: this.#routes, settings: this.#settings };
		this.snapshot = snapshot;

		const message = JSON.stringify({ type: 'snapshot', snapshot } satisfies HostMessage);
		for (const entry of this.#nodes.values()) entry.pairing.link.send(message);

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
		const route = this.#routes.find((r) => r.monitorId === sinkId);
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
		const timer = setTimeout(() => {
			this.#retryTimers.delete(timer);
			this.#reconcile();
		}, delay);
		this.#retryTimers.add(timer);
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

	#log(text: string): void {
		this.events = [{ at: Date.now(), text }, ...this.events].slice(0, 50);
	}
}
