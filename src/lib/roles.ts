import type { RoleId } from '$lib/charms/protocol';

export type { RoleId };

export interface Role {
	id: RoleId;
	/** 英字の略号（画面の隅に小さく出す） */
	code: string;
	/** CHARMS の頭文字 */
	letter: string;
	/** 英語の正式名 */
	name: string;
	/** 画面に大きく出す日本語の名前 */
	title: string;
	/** ひとことで言うと何をする端末か */
	summary: string;
	/** どんな端末で開くとよいか */
	device: string;
	/** 台数の目安 */
	limit: string;
	/** ページのパス */
	path: '/host/' | '/camera/' | '/admin/' | '/monitor/' | '/controller/';
}

export const roles: Role[] = [
	{
		id: 'host',
		code: 'HOST',
		letter: 'H',
		name: 'Host',
		title: 'ホスト',
		summary: '全員をつなぐ中心の1台です。最初にこれを1台だけ開きます。',
		device: 'カメラ付きのノート PC がおすすめ',
		limit: '1台だけ',
		path: '/host/'
	},
	{
		id: 'camera',
		code: 'CAM',
		letter: 'C',
		name: 'Camera',
		title: 'カメラ',
		summary: 'この端末のカメラや画面を、映像として送ります。',
		device: 'スマホ・タブレット・PC',
		limit: '何台でも',
		path: '/camera/'
	},
	{
		id: 'admin',
		code: 'ADM',
		letter: 'A',
		name: 'Admin',
		title: 'テロップ',
		summary: 'タイトルや歌詞などの文字を、映像として送ります。',
		device: 'キーボードのある PC がおすすめ',
		limit: '何台でも',
		path: '/admin/'
	},
	{
		id: 'monitor',
		code: 'MON',
		letter: 'M',
		name: 'Monitor',
		title: 'モニター',
		summary: '選ばれた映像を全画面で映します。',
		device: 'プロジェクターやテレビにつないだ端末',
		limit: '何台でも',
		path: '/monitor/'
	},
	{
		id: 'controller',
		code: 'CTRL',
		letter: 'R',
		name: 'Controller',
		title: 'スイッチャー',
		summary: 'どの映像をどのモニターに映すかを切り替えます。',
		device: 'タブレット・PC',
		limit: '何台でも',
		path: '/controller/'
	}
];

export function roleOf(id: RoleId): Role {
	return roles.find((role) => role.id === id)!;
}
