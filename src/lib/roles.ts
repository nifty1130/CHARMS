export type RoleId = 'host' | 'camera' | 'admin' | 'monitor' | 'controller';

export interface Role {
	id: RoleId;
	code: string;
	letter: string;
	name: string;
	nameJa: string;
	description: string;
	limit: string;
	href: string;
}

export const roles: Role[] = [
	{
		id: 'host',
		code: 'HOST',
		letter: 'H',
		name: 'Host',
		nameJa: 'シグナリングハブ',
		description:
			'全クライアントとのデータチャネルを束ね、ピアリングと制御命令を取り次ぐセッションの中継点。',
		limit: '× 1',
		href: '/host'
	},
	{
		id: 'camera',
		code: 'CAM',
		letter: 'C',
		name: 'Camera',
		nameJa: '映像入力',
		description:
			'Webカメラまたは画面共有の映像を、Host の指示で接続した Monitor に直接送出する。',
		limit: '× n',
		href: '/camera'
	},
	{
		id: 'admin',
		code: 'ADM',
		letter: 'A',
		name: 'Admin',
		nameJa: '管理者',
		description:
			'歌詞・タイトルなどのテキストを生成し、Host 経由で Monitor 表示として配信する。',
		limit: '× n',
		href: '/admin'
	},
	{
		id: 'monitor',
		code: 'MON',
		letter: 'M',
		name: 'Monitor',
		nameJa: '映像出力',
		description:
			'Host の指示に従って Camera と接続し、受け取った映像/テキストをフルスクリーン出力する。',
		limit: '× n',
		href: '/monitor'
	},
	{
		id: 'controller',
		code: 'CTRL',
		letter: 'R',
		name: 'Controller',
		nameJa: 'スイッチャー',
		description:
			'どの Camera をどの Monitor に割り当てるかをリアルタイムで切替える、操作端末。',
		limit: '× n',
		href: '/controller'
	}
];
