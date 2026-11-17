/**
 * 通信の状態を調べる
 *
 * 「映像がカクカクする」ときに、原因の見当を付けられるようにする。
 * 映像接続ごとに、経路（直接か、中継サーバー経由か）・通信量・コマ数・遅延・データの欠けを読む。
 */

import type { MediaLinks } from './media-links';
import type { LinkProfile, NetInfo } from './protocol';

/** 映像接続1本の状態 */
export interface LinkStats {
	/** 相手の端末の ID */
	peerId: string;
	/** この端末から見て、送っている（out）か、受けている（in）か */
	direction: 'in' | 'out';
	/** 送っている映像の種類（受けている側では分からないので null） */
	profile: LinkProfile | null;
	/** 経路（direct: 端末同士が直接 / relay: 中継サーバー経由） */
	path: 'direct' | 'relay' | 'unknown';
	/** 映像の通信量（kbps）。測り始めは null */
	kbps: number | null;
	/** 1秒あたりのコマ数 */
	fps: number | null;
	/** 映像の大きさ */
	width: number | null;
	height: number | null;
	/** 往復の遅延（ミリ秒） */
	rttMs: number | null;
	/** データの欠けの割合（%） */
	lossPercent: number | null;
	/** 画質を下げている理由（cpu: 端末の処理が追いつかない / bandwidth: 回線が細い） */
	limitation: 'none' | 'cpu' | 'bandwidth' | 'other' | null;
}

/** 前回の測定値（差分から通信量と欠けを計算するために覚えておく） */
export interface Counters {
	at: number;
	bytes: number;
	packets: number;
	lost: number;
}

type Entry = Record<string, unknown> & { id?: string; type?: string };
type Measured = Omit<LinkStats, 'peerId' | 'direction' | 'profile'>;

const num = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * ブラウザの統計情報（getStats の結果）から、映像接続1本の状態を読む
 *
 * @param entries 統計情報の項目
 * @param direction 送っているか、受けているか
 * @param previous 前回の測定値（初回は null）
 * @param now 測定した時刻（ミリ秒）
 */
export function summarize(
	entries: Iterable<Entry>,
	direction: 'in' | 'out',
	previous: Counters | null,
	now: number
): { stats: Measured; counters: Counters } {
	const byId = new Map<string, Entry>();
	const list: Entry[] = [];
	for (const entry of entries) {
		list.push(entry);
		if (typeof entry.id === 'string') byId.set(entry.id, entry);
	}
	const find = (type: string, video = true) =>
		list.find((e) => e.type === type && (!video || e.kind === 'video' || e.mediaType === 'video'));

	// ---- 経路と遅延 ----
	const transport = list.find((e) => e.type === 'transport' && typeof e.selectedCandidatePairId === 'string');
	const pair =
		(transport && byId.get(transport.selectedCandidatePairId as string)) ??
		list.find((e) => e.type === 'candidate-pair' && (e.selected === true || (e.nominated === true && e.state === 'succeeded')));

	let path: LinkStats['path'] = 'unknown';
	let rttMs: number | null = null;
	if (pair) {
		const local = byId.get(String(pair.localCandidateId));
		const remote = byId.get(String(pair.remoteCandidateId));
		if (local || remote) {
			path = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
		}
		const rtt = num(pair.currentRoundTripTime);
		if (rtt !== null) rttMs = Math.round(rtt * 1000);
	}

	// ---- 映像 ----
	const rtp = find(direction === 'out' ? 'outbound-rtp' : 'inbound-rtp');
	const bytes = num(direction === 'out' ? rtp?.bytesSent : rtp?.bytesReceived) ?? 0;
	const packets = num(rtp?.packetsReceived) ?? 0;
	const lost = Math.max(0, num(rtp?.packetsLost) ?? 0);
	const counters: Counters = { at: now, bytes, packets, lost };

	let kbps: number | null = null;
	let lossPercent: number | null = null;
	if (previous && now > previous.at && bytes >= previous.bytes) {
		kbps = Math.round(((bytes - previous.bytes) * 8) / (now - previous.at));
		if (direction === 'in') {
			const received = packets - previous.packets;
			const missing = Math.max(0, lost - previous.lost);
			if (received + missing > 0) lossPercent = round1((missing / (received + missing)) * 100);
		}
	}
	if (direction === 'out') {
		// 送る側では、相手が数えた欠けの割合を使う
		const remote = find('remote-inbound-rtp');
		const fraction = num(remote?.fractionLost);
		if (fraction !== null) lossPercent = round1(fraction * 100);
		const rtt = num(remote?.roundTripTime);
		if (rttMs === null && rtt !== null) rttMs = Math.round(rtt * 1000);
	}

	const reason = rtp?.qualityLimitationReason;
	const limitation: LinkStats['limitation'] =
		direction !== 'out' || typeof reason !== 'string'
			? null
			: reason === 'cpu' || reason === 'bandwidth' || reason === 'none'
				? reason
				: 'other';

	const fps = num(rtp?.framesPerSecond);
	return {
		stats: {
			path,
			kbps,
			fps: fps === null ? null : Math.round(fps),
			width: num(rtp?.frameWidth),
			height: num(rtp?.frameHeight),
			rttMs,
			lossPercent,
			limitation
		},
		counters
	};
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * 映像接続1本の状態を、3段階で評価する
 *
 * - `poor`（不安定）: 欠けが 5% 以上、または遅延が 400 ミリ秒以上
 * - `fair`（やや不安定）: 欠けが 1% 以上、または遅延が 150 ミリ秒以上
 * - `good`（良好）: それ以外
 *
 * コマ数や「画質を下げている理由」は、評価に使わない。動きのないテロップはコマ数が少なく、
 * 確認用の小さな映像は意図して画質を絞っているので、正常でも異常に見えてしまうため。
 */
export function gradeLink(link: LinkStats): NetInfo['quality'] {
	const loss = link.lossPercent ?? 0;
	const rtt = link.rttMs ?? 0;
	if (loss >= 5 || rtt >= 400) return 'poor';
	if (loss >= 1 || rtt >= 150) return 'fair';
	return 'good';
}

/** 端末全体の通信の状態（いちばん悪い接続の評価）をまとめる。映像接続がなければ null */
export function summarizeNet(links: LinkStats[]): NetInfo | null {
	if (links.length === 0) return null;
	const order: NetInfo['quality'][] = ['good', 'fair', 'poor'];
	let worst = 0;
	for (const link of links) worst = Math.max(worst, order.indexOf(gradeLink(link)));
	return { relay: links.some((link) => link.path === 'relay'), quality: order[worst] };
}

/**
 * 映像接続の状態を、一定の間隔で調べ続ける
 */
export class StatsWatcher {
	readonly #media: MediaLinks;
	readonly #onUpdate: (links: LinkStats[]) => void;
	readonly #previous = new WeakMap<RTCPeerConnection, Counters>();
	readonly #timer: ReturnType<typeof setInterval>;
	#busy = false;
	#hadLinks = false;

	/**
	 * @param media 調べる映像接続
	 * @param onUpdate 調べるたびに呼ばれる
	 * @param intervalMs 調べる間隔
	 */
	constructor(media: MediaLinks, onUpdate: (links: LinkStats[]) => void, intervalMs = 2000) {
		this.#media = media;
		this.#onUpdate = onUpdate;
		this.#timer = setInterval(() => void this.#poll(), intervalMs);
	}

	destroy(): void {
		clearInterval(this.#timer);
	}

	async #poll(): Promise<void> {
		if (this.#busy) return;
		const connections = this.#media.connections();
		if (connections.length === 0) {
			// 接続がなくなったことを、1回だけ知らせる
			if (this.#hadLinks) this.#onUpdate([]);
			this.#hadLinks = false;
			return;
		}

		this.#busy = true;
		try {
			const links: LinkStats[] = [];
			for (const { peerId, direction, profile, pc } of connections) {
				if (pc.connectionState !== 'connected') continue;
				try {
					const report = await pc.getStats();
					const entries: Record<string, unknown>[] = [];
					report.forEach((entry) => entries.push(entry as Record<string, unknown>));
					const { stats, counters } = summarize(
						entries,
						direction,
						this.#previous.get(pc) ?? null,
						performance.now()
					);
					this.#previous.set(pc, counters);
					links.push({ peerId, direction, profile, ...stats });
				} catch {
					// 調べている間に接続が閉じた
				}
			}
			this.#hadLinks = true;
			this.#onUpdate(links);
		} finally {
			this.#busy = false;
		}
	}
}
