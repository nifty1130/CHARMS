import { describe, expect, it } from 'vitest';
import { cleanName, parseMessage, type NodeInfo, type Route } from './protocol';
import {
	applyRoute,
	applyTake,
	desiredLinks,
	diffLinks,
	linkKey,
	syncRoutes,
	tallyFor
} from './routing';

function node(id: string, role: NodeInfo['role'], live = false): NodeInfo {
	return { id, role, name: id, live, recording: false };
}

const nodes: NodeInfo[] = [
	node('cam1', 'camera', true),
	node('cam2', 'camera', true),
	node('cam3', 'camera', false), // まだ映像を出していない
	node('adm1', 'admin', true),
	node('mon1', 'monitor'),
	node('mon2', 'monitor'),
	node('ctrl1', 'controller'),
	node('ctrl2', 'controller')
];

const keys = (links: { sourceId: string; sinkId: string }[]) =>
	links.map((l) => linkKey(l.sourceId, l.sinkId)).sort();

describe('desiredLinks', () => {
	it('映像を出している入力は、ホストと全スイッチャーに確認用映像を送る', () => {
		const links = desiredLinks(nodes, []);
		expect(keys(links)).toEqual(
			[
				'cam1>host',
				'cam1>ctrl1',
				'cam1>ctrl2',
				'cam2>host',
				'cam2>ctrl1',
				'cam2>ctrl2',
				'adm1>host',
				'adm1>ctrl1',
				'adm1>ctrl2'
			].sort()
		);
		expect(links.every((l) => l.profile === 'thumbnail')).toBe(true);
	});

	it('本番と予告に選ばれた入力は、そのモニターに本番用映像を送る', () => {
		const routes: Route[] = [
			{ monitorId: 'mon1', program: 'cam1', preview: 'cam2' },
			{ monitorId: 'mon2', program: 'adm1', preview: null }
		];
		const program = desiredLinks(nodes, routes).filter((l) => l.profile === 'program');
		expect(keys(program)).toEqual(['adm1>mon2', 'cam1>mon1', 'cam2>mon1']);
	});

	it('映像を出していない入力や、いないモニターへの接続は作らない', () => {
		const routes: Route[] = [
			{ monitorId: 'mon1', program: 'cam3', preview: 'cam3' },
			{ monitorId: 'mon9', program: 'cam1', preview: null }
		];
		expect(desiredLinks(nodes, routes).filter((l) => l.profile === 'program')).toEqual([]);
	});

	it('本番と予告が同じ入力でも、接続は1本だけ', () => {
		const routes: Route[] = [{ monitorId: 'mon1', program: 'cam1', preview: 'cam1' }];
		expect(desiredLinks(nodes, routes).filter((l) => l.sinkId === 'mon1')).toHaveLength(1);
	});
});

describe('syncRoutes', () => {
	it('モニターごとに1行を用意し、いなくなった端末を取り除く', () => {
		const routes: Route[] = [
			{ monitorId: 'mon1', program: 'cam1', preview: 'gone' },
			{ monitorId: 'mon9', program: 'cam1', preview: null }
		];
		expect(syncRoutes(routes, nodes)).toEqual([
			{ monitorId: 'mon1', program: 'cam1', preview: null },
			{ monitorId: 'mon2', program: null, preview: null }
		]);
	});

	it('映像を出していないだけの入力は、経路に残す（復帰したら自動でつなぎ直すため）', () => {
		const routes: Route[] = [{ monitorId: 'mon1', program: 'cam3', preview: null }];
		expect(syncRoutes(routes, nodes)[0].program).toBe('cam3');
	});
});

describe('applyRoute / applyTake', () => {
	const routes: Route[] = [
		{ monitorId: 'mon1', program: 'cam1', preview: null },
		{ monitorId: 'mon2', program: null, preview: null }
	];

	it('予告を選んでも本番は変わらない', () => {
		expect(applyRoute(routes, ['mon1'], 'preview', 'cam2')).toEqual([
			{ monitorId: 'mon1', program: 'cam1', preview: 'cam2' },
			routes[1]
		]);
	});

	it('本番を直接切り替えても、予告は変わらない', () => {
		expect(applyRoute(routes, ['mon1'], 'program', 'cam2')[0]).toEqual({
			monitorId: 'mon1',
			program: 'cam2',
			preview: null
		});
		const prepared = applyRoute(routes, ['mon1'], 'preview', 'adm1');
		expect(applyRoute(prepared, ['mon1'], 'program', 'cam2')[0].preview).toBe('adm1');
	});

	it('予告に入れていた映像を直接本番に出すと、予告からは外れる', () => {
		const prepared = applyRoute(routes, ['mon1'], 'preview', 'cam2');
		expect(applyRoute(prepared, ['mon1'], 'program', 'cam2')[0]).toEqual({
			monitorId: 'mon1',
			program: 'cam2',
			preview: null
		});
	});

	it('全モニターを一括で切り替えられる', () => {
		expect(applyRoute(routes, 'all', 'program', 'adm1').map((r) => r.program)).toEqual([
			'adm1',
			'adm1'
		]);
	});

	it('本番を空にすると黒画面になる', () => {
		expect(applyRoute(routes, ['mon1'], 'program', null)[0]).toEqual({
			monitorId: 'mon1',
			program: null,
			preview: null
		});
	});

	it('すでに本番の映像を選び直しても何も変わらない', () => {
		expect(applyRoute(routes, ['mon1'], 'program', 'cam1')).toEqual(routes);
	});

	it('切替（TAKE）で本番と予告が入れ替わる', () => {
		const prepared = applyRoute(routes, 'all', 'preview', 'cam2');
		expect(applyTake(prepared, 'all')).toEqual([
			{ monitorId: 'mon1', program: 'cam2', preview: 'cam1' },
			{ monitorId: 'mon2', program: 'cam2', preview: null }
		]);
	});

	it('予告がないモニターは、切替しても変わらない', () => {
		expect(applyTake(routes, 'all')).toEqual(routes);
	});
});

describe('diffLinks', () => {
	it('足りない接続と、余っている接続を求める', () => {
		const desired = desiredLinks(nodes, [{ monitorId: 'mon1', program: 'cam1', preview: null }]);
		const diff = diffLinks(desired, ['cam1>host', 'cam9>mon1']);
		expect(diff.removed).toEqual(['cam9>mon1']);
		expect(keys(diff.added)).toContain('cam1>mon1');
		expect(keys(diff.added)).not.toContain('cam1>host');
	});
});

describe('tallyFor', () => {
	it('自分の映像がどのモニターの本番・予告に出ているかが分かる', () => {
		const routes: Route[] = [
			{ monitorId: 'mon1', program: 'cam1', preview: 'cam2' },
			{ monitorId: 'mon2', program: 'cam2', preview: 'cam1' }
		];
		expect(tallyFor('cam1', routes)).toEqual({ program: ['mon1'], preview: ['mon2'] });
		expect(tallyFor('cam3', routes)).toEqual({ program: [], preview: [] });
	});
});

describe('protocol', () => {
	it('壊れたメッセージは null になる', () => {
		expect(parseMessage('{"type":"take","monitors":"all"}')).toEqual({ type: 'take', monitors: 'all' });
		expect(parseMessage('not json')).toBeNull();
		expect(parseMessage('{"no":"type"}')).toBeNull();
		expect(parseMessage('null')).toBeNull();
		expect(parseMessage(new ArrayBuffer(4))).toBeNull();
	});

	it('名前を整える', () => {
		expect(cleanName('  体育館\n ステージ  ', 'x')).toBe('体育館 ステージ');
		expect(cleanName('   ', 'カメラ 1')).toBe('カメラ 1');
		expect(cleanName(42, 'カメラ 1')).toBe('カメラ 1');
		expect(cleanName('あ'.repeat(100), 'x')).toHaveLength(24);
	});
});
