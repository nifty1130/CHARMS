/**
 * 映像の経路の計算（状態を持たない純粋な関数だけを置く）
 *
 * ホストは「どの映像入力からどの端末へ映像を送るべきか」をここで計算し、
 * 実際の接続との差分だけを各端末に指示する。
 */

import {
	HOST_ID,
	isSourceRole,
	type LinkProfile,
	type MonitorTarget,
	type NodeInfo,
	type Route
} from './protocol';

/** 「この映像入力から、この端末へ、この送り方で送る」という1本の映像接続 */
export interface DesiredLink {
	sourceId: string;
	sinkId: string;
	profile: LinkProfile;
}

/** 映像接続を区別するためのキー */
export function linkKey(sourceId: string, sinkId: string): string {
	return `${sourceId}>${sinkId}`;
}

/**
 * いま必要な映像接続をすべて挙げる
 *
 * - 映像を出せる状態のカメラ・テロップ → ホストと全スイッチャー（確認用の小さな映像）
 * - 各モニターの本番・予告に選ばれた入力 → そのモニター（本番用の映像）
 */
export function desiredLinks(nodes: NodeInfo[], routes: Route[]): DesiredLink[] {
	const live = new Set(nodes.filter((n) => isSourceRole(n.role) && n.live).map((n) => n.id));
	const controllers = nodes.filter((n) => n.role === 'controller');
	const monitors = new Set(nodes.filter((n) => n.role === 'monitor').map((n) => n.id));

	const links: DesiredLink[] = [];
	for (const sourceId of live) {
		links.push({ sourceId, sinkId: HOST_ID, profile: 'thumbnail' });
		for (const controller of controllers) {
			links.push({ sourceId, sinkId: controller.id, profile: 'thumbnail' });
		}
	}
	for (const route of routes) {
		if (!monitors.has(route.monitorId)) continue;
		for (const sourceId of new Set([route.program, route.preview])) {
			if (sourceId && live.has(sourceId)) {
				links.push({ sourceId, sinkId: route.monitorId, profile: 'program' });
			}
		}
	}
	return links;
}

/**
 * 端末の増減に合わせて経路表を整える
 *
 * - いなくなったモニターの行を消す
 * - 新しいモニターの行を足す（何も映さない状態から始める）
 * - いなくなった映像入力を指している欄を空にする
 */
export function syncRoutes(routes: Route[], nodes: NodeInfo[]): Route[] {
	const sources = new Set(nodes.filter((n) => isSourceRole(n.role)).map((n) => n.id));
	const keep = (id: string | null) => (id && sources.has(id) ? id : null);

	return nodes
		.filter((n) => n.role === 'monitor')
		.map((monitor) => {
			const current = routes.find((r) => r.monitorId === monitor.id);
			return {
				monitorId: monitor.id,
				program: keep(current?.program ?? null),
				preview: keep(current?.preview ?? null)
			};
		});
}

/** 対象のモニターかどうかを判定する関数を作る */
function matcher(target: MonitorTarget): (monitorId: string) => boolean {
	if (target === 'all') return () => true;
	const ids = new Set(target);
	return (monitorId) => ids.has(monitorId);
}

/**
 * モニターに映す映像（本番）または次に映す映像（予告）を選ぶ
 *
 * 本番を直接切り替えても、予告は変えない（同じ映像が予告に入っていた場合だけ外す）。
 */
export function applyRoute(
	routes: Route[],
	target: MonitorTarget,
	stage: 'program' | 'preview',
	sourceId: string | null
): Route[] {
	const matches = matcher(target);
	return routes.map((route) => {
		if (!matches(route.monitorId)) return route;
		if (stage === 'preview') {
			return { ...route, preview: sourceId };
		}
		if (route.program === sourceId) return route;
		return {
			...route,
			program: sourceId,
			preview: route.preview === sourceId ? null : route.preview
		};
	});
}

/**
 * 予告の映像を本番に出す（本番と予告を入れ替える）
 *
 * 入れ替えるので、それまで本番だった映像が予告に残り、もう一度押せばすぐ戻せる。
 * 予告が選ばれていないモニターは何もしない。
 */
export function applyTake(routes: Route[], target: MonitorTarget): Route[] {
	const matches = matcher(target);
	return routes.map((route) => {
		if (!matches(route.monitorId) || !route.preview) return route;
		return { ...route, program: route.preview, preview: route.program };
	});
}

/** 2つの接続一覧の差分 */
export interface LinkDiff {
	/** 新しく張る接続 */
	added: DesiredLink[];
	/** 切る接続（キー） */
	removed: string[];
}

/**
 * 必要な接続と、いま張っている接続を比べる
 *
 * @param desired 必要な接続
 * @param active いま張っている（または張ろうとしている）接続のキー
 */
export function diffLinks(desired: DesiredLink[], active: Iterable<string>): LinkDiff {
	const wanted = new Map(desired.map((link) => [linkKey(link.sourceId, link.sinkId), link]));
	const current = new Set(active);
	return {
		added: [...wanted].filter(([key]) => !current.has(key)).map(([, link]) => link),
		removed: [...current].filter((key) => !wanted.has(key))
	};
}

/**
 * 映像入力が、いまどのモニターに出ているかを調べる（カメラの「本番中」表示用）
 *
 * @returns 本番に出ているモニターと、予告に入っているモニターの ID
 */
export function tallyFor(sourceId: string, routes: Route[]): { program: string[]; preview: string[] } {
	return {
		program: routes.filter((r) => r.program === sourceId).map((r) => r.monitorId),
		preview: routes.filter((r) => r.preview === sourceId && r.program !== sourceId).map((r) => r.monitorId)
	};
}
