/**
 * スタッフの連携（指示メッセージ、インカム）の、計算部分のテスト
 */

import { describe, expect, it } from 'vitest';
import { cleanCue, MAX_CUE_LENGTH, type NodeInfo } from './protocol';
import { desiredLinks } from './routing';

const node = (id: string, role: NodeInfo['role'], extra: Partial<NodeInfo> = {}): NodeInfo => ({
	id,
	role,
	name: id,
	live: true,
	recording: false,
	...extra
});

describe('指示メッセージ', () => {
	it('前後の空白と改行を整え、長すぎる文は切り詰める', () => {
		expect(cleanCue('  寄って \n ください ')).toBe('寄って ください');
		expect(cleanCue('あ'.repeat(200))).toHaveLength(MAX_CUE_LENGTH);
	});

	it('文字列でないもの・空の文は、空になる（送らない）', () => {
		expect(cleanCue(undefined)).toBe('');
		expect(cleanCue({ text: 'x' })).toBe('');
		expect(cleanCue('   ')).toBe('');
	});
});

describe('インカム', () => {
	const talkLinks = (nodes: NodeInfo[]) => desiredLinks(nodes, []).filter((link) => link.profile === 'talk');

	it('話しているスイッチャーから、聞く設定にしたカメラへだけ、声の接続を張る', () => {
		const nodes = [
			node('cam1', 'camera', { listening: true }),
			node('cam2', 'camera'),
			node('adm1', 'admin', { listening: true }),
			node('mon1', 'monitor'),
			node('ctrl1', 'controller', { talking: true }),
			node('ctrl2', 'controller')
		];
		expect(talkLinks(nodes)).toEqual([
			{ sourceId: 'ctrl1', sinkId: 'cam1', profile: 'talk' },
			{ sourceId: 'ctrl1', sinkId: 'adm1', profile: 'talk' }
		]);
	});

	it('だれも話していない、またはだれも聞いていないときは、張らない', () => {
		expect(talkLinks([node('cam1', 'camera', { listening: true }), node('ctrl1', 'controller')])).toEqual([]);
		expect(talkLinks([node('cam1', 'camera'), node('ctrl1', 'controller', { talking: true })])).toEqual([]);
	});

	it('映像を出していないカメラにも、声は届く', () => {
		const nodes = [node('cam1', 'camera', { live: false, listening: true }), node('ctrl1', 'controller', { talking: true })];
		expect(talkLinks(nodes)).toHaveLength(1);
		// 確認用の映像の接続は、張らない
		expect(desiredLinks(nodes, []).filter((link) => link.profile === 'thumbnail')).toEqual([]);
	});

	it('モニターには、声を流さない', () => {
		const nodes = [
			node('mon1', 'monitor', { listening: true }),
			node('ctrl1', 'controller', { talking: true })
		];
		expect(talkLinks(nodes)).toEqual([]);
	});
});
