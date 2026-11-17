/**
 * 画面の合成・通信の状態・カメラのズームの、計算部分のテスト
 */

import { describe, expect, it } from 'vitest';
import { clampZoom, readTorch, readZoom, setTorch, setZoom } from './camera-controls';
import type { NodeInfo, Route } from './protocol';
import { applyLayout, applyRoute, desiredLinks, secondaryOf, syncRoutes, tallyFor } from './routing';
import { gradeLink, summarize, summarizeNet, type LinkStats } from './stats';

const node = (id: string, role: NodeInfo['role'], live = true): NodeInfo => ({
	id,
	role,
	name: id,
	live,
	recording: false
});
const nodes = [node('cam1', 'camera'), node('cam2', 'camera'), node('adm1', 'admin'), node('mon1', 'monitor'), node('mon2', 'monitor')];
const routes: Route[] = [
	{ monitorId: 'mon1', program: 'cam1', preview: null },
	{ monitorId: 'mon2', program: 'cam1', preview: null }
];

describe('画面の合成（ワイプ・2画面・テロップ重ね）', () => {
	it('選んだモニターだけ、画面の作り方と重ねる映像を変える', () => {
		const next = applyLayout(routes, ['mon1'], 'pip', 'cam2');
		expect(next[0]).toEqual({ monitorId: 'mon1', program: 'cam1', preview: null, layout: 'pip', sub: 'cam2' });
		expect(next[1]).toEqual(routes[1]);
		expect(secondaryOf(next[0])).toBe('cam2');
		expect(secondaryOf(next[1])).toBeNull();
	});

	it('1画面に戻すと、重ねる映像の指定も消える', () => {
		const overlay = applyLayout(routes, 'all', 'overlay', 'adm1');
		expect(applyLayout(overlay, 'all', 'single', null)).toEqual(routes);
	});

	it('重ねる映像にも、モニターへの映像接続を張る', () => {
		const next = applyLayout(routes, ['mon1'], 'overlay', 'adm1');
		const toMon1 = desiredLinks(nodes, next).filter((link) => link.sinkId === 'mon1');
		expect(toMon1.map((link) => link.sourceId).sort()).toEqual(['adm1', 'cam1']);
		expect(toMon1.every((link) => link.profile === 'program')).toBe(true);
		// 1画面のモニターには、本番の映像だけ
		expect(desiredLinks(nodes, next).filter((link) => link.sinkId === 'mon2')).toHaveLength(1);
	});

	it('重ねている映像も「本番中」として扱う（カメラの赤い帯が出る）', () => {
		const next = applyLayout(routes, ['mon1'], 'pip', 'cam2');
		expect(tallyFor('cam2', next)).toEqual({ program: ['mon1'], preview: [] });
		expect(tallyFor('cam1', next).program).toEqual(['mon1', 'mon2']);
	});

	it('本番の映像を切り替えても、画面の作り方は変わらない', () => {
		const next = applyRoute(applyLayout(routes, ['mon1'], 'split', 'cam2'), ['mon1'], 'program', 'adm1');
		expect(next[0]).toMatchObject({ program: 'adm1', layout: 'split', sub: 'cam2' });
	});

	it('重ねていた映像の端末がいなくなったら、重ねる映像を空にする', () => {
		const next = applyLayout(routes, ['mon1'], 'pip', 'cam2');
		const remaining = nodes.filter((n) => n.id !== 'cam2');
		expect(syncRoutes(next, remaining)[0]).toMatchObject({ layout: 'pip', sub: null });
		expect(desiredLinks(remaining, syncRoutes(next, remaining)).filter((l) => l.sinkId === 'mon1')).toHaveLength(1);
	});
});

describe('通信の状態', () => {
	const pair = (local: string, remote: string, rtt = 0.02) => [
		{ id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
		{ id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: rtt },
		{ id: 'L', type: 'local-candidate', candidateType: local },
		{ id: 'R', type: 'remote-candidate', candidateType: remote }
	];

	it('送っている映像の、経路・通信量・コマ数・遅延・欠けを読む', () => {
		const entries: Record<string, unknown>[] = [
			...pair('host', 'srflx'),
			{ id: 'O', type: 'outbound-rtp', kind: 'video', bytesSent: 500_000, framesPerSecond: 29.6, frameWidth: 1280, frameHeight: 720, qualityLimitationReason: 'cpu' },
			{ id: 'A', type: 'outbound-rtp', kind: 'audio', bytesSent: 9_999_999 },
			{ id: 'RI', type: 'remote-inbound-rtp', kind: 'video', fractionLost: 0.025 }
		];
		const first = summarize(entries, 'out', null, 1000);
		expect(first.stats).toMatchObject({ path: 'direct', kbps: null, fps: 30, width: 1280, rttMs: 20, lossPercent: 2.5, limitation: 'cpu' });

		// 2秒後に 500KB 増えていれば、2000 kbps
		entries[4] = { ...entries[4], bytesSent: 1_000_000 };
		expect(summarize(entries, 'out', first.counters, 3000).stats.kbps).toBe(2000);
	});

	it('どちらかの端末が中継を使っていれば「中継」になる', () => {
		expect(summarize(pair('relay', 'host'), 'out', null, 0).stats.path).toBe('relay');
		expect(summarize(pair('host', 'relay'), 'in', null, 0).stats.path).toBe('relay');
		expect(summarize([], 'in', null, 0).stats.path).toBe('unknown');
	});

	it('受けている映像の欠けは、前回からの増え方で計算する', () => {
		const at = (received: number, lost: number, bytes: number) => [
			...pair('host', 'host'),
			{ id: 'I', type: 'inbound-rtp', kind: 'video', bytesReceived: bytes, packetsReceived: received, packetsLost: lost, framesPerSecond: 30 }
		];
		const first = summarize(at(1000, 0, 100_000), 'in', null, 0);
		expect(first.stats.lossPercent).toBeNull();
		const second = summarize(at(1900, 100, 350_000), 'in', first.counters, 1000);
		expect(second.stats).toMatchObject({ lossPercent: 10, kbps: 2000, limitation: null });
	});

	const link = (over: Partial<LinkStats>): LinkStats => ({
		peerId: 'mon1',
		direction: 'out',
		profile: 'program',
		path: 'direct',
		kbps: 2000,
		fps: 30,
		width: 1280,
		height: 720,
		rttMs: 10,
		lossPercent: 0,
		limitation: 'none',
		...over
	});

	it('欠けと遅延から、3段階で評価する', () => {
		expect(gradeLink(link({}))).toBe('good');
		expect(gradeLink(link({ lossPercent: 1.5 }))).toBe('fair');
		expect(gradeLink(link({ rttMs: 200 }))).toBe('fair');
		expect(gradeLink(link({ lossPercent: 8 }))).toBe('poor');
		expect(gradeLink(link({ rttMs: 600 }))).toBe('poor');
		// 動きのないテロップ（コマ数が少ない）や、画質を絞っている確認用の映像は、正常
		expect(gradeLink(link({ fps: 1 }))).toBe('good');
		expect(gradeLink(link({ profile: 'thumbnail', fps: 10, kbps: 120, limitation: 'bandwidth' }))).toBe('good');
		// 測り始めで値がないときは、悪いとは言わない
		expect(gradeLink(link({ kbps: null, fps: null, rttMs: null, lossPercent: null, limitation: null }))).toBe('good');
	});

	it('端末全体では、いちばん悪い接続の評価を使う', () => {
		expect(summarizeNet([])).toBeNull();
		expect(summarizeNet([link({}), link({ lossPercent: 2 })])).toEqual({ relay: false, quality: 'fair' });
		expect(summarizeNet([link({ path: 'relay' }), link({ rttMs: 500 })])).toEqual({ relay: true, quality: 'poor' });
	});
});

describe('カメラのズームとライト', () => {
	/** ズームとライトに対応したカメラのふり */
	function fakeTrack(capabilities: object, initial: Record<string, unknown> = {}) {
		const settings = { ...initial };
		const applied: object[] = [];
		const track = {
			getCapabilities: () => capabilities,
			getSettings: () => settings,
			applyConstraints: async (constraints: { advanced?: Record<string, unknown>[] }) => {
				applied.push(constraints);
				Object.assign(settings, constraints.advanced?.[0]);
			}
		} as unknown as MediaStreamTrack;
		return { track, applied };
	}

	it('対応していないカメラでは null になる', () => {
		const { track } = fakeTrack({});
		expect(readZoom(track)).toBeNull();
		expect(readTorch(track)).toBeNull();
		expect(readZoom(null)).toBeNull();
		// 範囲のないズーム（最小と最大が同じ）も、できない扱いにする
		expect(readZoom(fakeTrack({ zoom: { min: 1, max: 1 } }).track)).toBeNull();
	});

	it('ズームの範囲と値を読み、範囲の中で変えられる', async () => {
		const { track, applied } = fakeTrack({ zoom: { min: 1, max: 5, step: 0.1 } }, { zoom: 1 });
		expect(readZoom(track)).toEqual({ min: 1, max: 5, step: 0.1, value: 1 });

		expect((await setZoom(track, 3))?.value).toBe(3);
		expect((await setZoom(track, 99))?.value).toBe(5);
		expect(applied).toEqual([{ advanced: [{ zoom: 3 }] }, { advanced: [{ zoom: 5 }] }]);
		expect(clampZoom({ min: 1, max: 5 }, Number.NaN)).toBe(1);
	});

	it('ライトを点ける・消す', async () => {
		const { track } = fakeTrack({ torch: true });
		expect(readTorch(track)).toBe(false);
		expect(await setTorch(track, true)).toBe(true);
		expect(await setTorch(track, false)).toBe(false);
		// ライトのないカメラでは何もしない
		expect(await setTorch(fakeTrack({}).track, true)).toBeNull();
	});
});
