/**
 * 同じ端末の中でつなぐ（QR なし）
 *
 * 1台の PC でホストとスイッチャーを両方開く、といった使い方のための近道。
 * 同じブラウザの別タブ同士は BroadcastChannel で直接やり取りできるので、
 * QR を見せ合う代わりに、接続情報を自動で交換する。
 *
 * 別の端末には届かない（同じブラウザの中だけ）ので、勝手に他人がつながることはない。
 */

import type { Pairing } from './pairing.svelte';

const CHANNEL_NAME = 'charms-local-pairing';

type LocalMessage =
	| { kind: 'probe' }
	| { kind: 'here' }
	| { kind: 'gone' }
	| { kind: 'hello'; from: string; qrText: string }
	| { kind: 'welcome'; to: string; qrText: string }
	| { kind: 'refused'; to: string };

function openChannel(): BroadcastChannel | null {
	return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
}

/**
 * ホスト側: 同じ端末の別タブからの接続を受け付ける
 */
export class LocalHostBeacon {
	#channel = openChannel();

	/**
	 * @param onHello 別タブから接続情報が届いたときに呼ばれる。ホスト側の接続情報を返す（受け付けられないときは null）
	 */
	constructor(onHello: (qrText: string) => Promise<string | null>) {
		if (!this.#channel) return;
		this.#channel.onmessage = async (event: MessageEvent<LocalMessage>) => {
			const message = event.data;
			if (message.kind === 'probe') {
				this.#channel?.postMessage({ kind: 'here' } satisfies LocalMessage);
			} else if (message.kind === 'hello') {
				const qrText = await onHello(message.qrText).catch(() => null);
				this.#channel?.postMessage(
					(qrText
						? { kind: 'welcome', to: message.from, qrText }
						: { kind: 'refused', to: message.from }) satisfies LocalMessage
				);
			}
		};
		this.#channel.postMessage({ kind: 'here' } satisfies LocalMessage);
	}

	close(): void {
		this.#channel?.postMessage({ kind: 'gone' } satisfies LocalMessage);
		this.#channel?.close();
		this.#channel = null;
	}
}

/**
 * 端末側: 同じ端末でホストが開かれているかを調べ、あれば QR なしでつなぐ
 */
export class LocalHostFinder {
	/** 同じ端末でホストが開かれているか */
	available = $state(false);

	readonly #channel = openChannel();
	readonly #id = crypto.randomUUID();
	#waiting: ((qrText: string | null) => void) | null = null;

	constructor() {
		if (!this.#channel) return;
		this.#channel.onmessage = (event: MessageEvent<LocalMessage>) => {
			const message = event.data;
			if (message.kind === 'here') this.available = true;
			else if (message.kind === 'gone') this.available = false;
			else if (message.kind === 'welcome' && message.to === this.#id) this.#waiting?.(message.qrText);
			else if (message.kind === 'refused' && message.to === this.#id) this.#waiting?.(null);
		};
		this.#channel.postMessage({ kind: 'probe' } satisfies LocalMessage);
	}

	/**
	 * 同じ端末のホストと、QR なしでつなぐ
	 *
	 * @param pairing 準備ができている（QR を表示できる状態の）手続き
	 * @returns つなぐ手続きを始められたら true
	 */
	async connect(pairing: Pairing): Promise<boolean> {
		if (!this.#channel || !pairing.qrText) return false;

		const reply = new Promise<string | null>((resolve) => {
			const timer = setTimeout(() => resolve(null), 5000);
			this.#waiting = (qrText) => {
				clearTimeout(timer);
				resolve(qrText);
			};
		});
		this.#channel.postMessage({
			kind: 'hello',
			from: this.#id,
			qrText: pairing.qrText
		} satisfies LocalMessage);

		const hostQrText = await reply;
		this.#waiting = null;
		if (!hostQrText) {
			this.available = false;
			return false;
		}
		return pairing.accept(hostQrText);
	}

	close(): void {
		this.#channel?.close();
	}
}
