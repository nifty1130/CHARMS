/**
 * 画面の自動消灯を防ぐ
 *
 * 本番中に端末がスリープすると接続が切れてしまうため、役割の画面を開いている間は
 * 画面をつけたままにする。対応していないブラウザでは何もしない。
 */

/**
 * 画面をつけたままにする
 *
 * @returns 解除するための関数（ページを離れるときに呼ぶ）
 */
export function keepScreenAwake(): () => void {
	if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return () => {};

	let sentinel: WakeLockSentinel | null = null;
	let released = false;

	const acquire = async () => {
		if (released || document.visibilityState !== 'visible') return;
		try {
			sentinel = await navigator.wakeLock.request('screen');
		} catch {
			// バッテリー残量が少ないときなどは拒否される。動作には影響しない
		}
	};

	// タブを切り替えると自動で解除されるので、戻ってきたときに取り直す
	const onVisibility = () => void acquire();
	document.addEventListener('visibilitychange', onVisibility);
	void acquire();

	return () => {
		released = true;
		document.removeEventListener('visibilitychange', onVisibility);
		void sentinel?.release().catch(() => {});
	};
}

/**
 * 誤ってページを閉じたり再読み込みしたりしないよう、確認を出す
 *
 * @param shouldWarn 確認が必要な状態かどうかを返す関数
 * @returns 解除するための関数
 */
export function confirmBeforeLeaving(shouldWarn: () => boolean): () => void {
	const onBeforeUnload = (event: BeforeUnloadEvent) => {
		if (shouldWarn()) event.preventDefault();
	};
	window.addEventListener('beforeunload', onBeforeUnload);
	return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
