/**
 * Pairing — QR を見せ合って2台をつなぐ、1回分の手続き
 *
 * {@link PeerLink} を画面から扱いやすくしたもの。状態が変わると画面が自動で更新される。
 */

import { LinkError, PacketDecodeError, PeerLink, SelfConnectionError, type LinkState } from '$lib/rtc';

export interface PairingHandlers {
	/** つながったとき */
	onOpen?: (pairing: Pairing) => void;
	/** メッセージが届いたとき */
	onMessage?: (data: unknown, pairing: Pairing) => void;
	/** つながったあとで切れたとき（つながる前の失敗では呼ばれない） */
	onEnd?: (pairing: Pairing) => void;
}

/** 同じ「読み取れない QR」について、注意を出し直すまでの間隔 */
const NOTICE_REPEAT_MS = 3000;

export class Pairing {
	/** 接続の進み具合 */
	state = $state<LinkState>('idle');
	/** 自分の QR に入れる文字列（準備ができるまでは空） */
	qrText = $state('');
	/** やり直しが必要なエラー */
	error = $state<string | null>(null);
	/** 読み取りについての一時的な注意（別の QR を読んだ、など） */
	notice = $state<string | null>(null);
	/** 相手の QR を読み取ったか */
	scanned = $state(false);
	/** 4桁の確認コード（両方の端末で同じ数字になる） */
	code = $state<string | null>(null);

	readonly link: PeerLink;
	readonly #handlers: PairingHandlers;
	#wasConnected = false;
	#lastRejected = { text: '', at: 0 };
	#starting: Promise<void> | null = null;

	constructor(handlers: PairingHandlers = {}) {
		this.#handlers = handlers;
		this.link = new PeerLink({
			onStateChange: (state) => this.#onStateChange(state),
			onMessage: (data) => this.#handlers.onMessage?.(data, this),
			onError: (error) => {
				this.error = error.message;
			}
		});
	}

	/**
	 * 自分の接続情報を集めて、QR を表示できるようにする
	 *
	 * 何度呼んでもよい。準備の途中で呼ばれたときは、その完了を待つ。
	 */
	start(): Promise<void> {
		this.#starting ??= (async () => {
			try {
				await this.link.prepare();
				this.qrText = this.link.qrText;
			} catch (error) {
				this.error = error instanceof Error ? error.message : String(error);
			}
		})();
		return this.#starting;
	}

	/**
	 * 相手の QR から読み取った文字列を受け取る
	 *
	 * QR リーダーは同じコードを何度も読むので、何度呼んでもよい。
	 *
	 * @returns 相手の QR として受け付けたら true
	 */
	async accept(text: string): Promise<boolean> {
		if (this.state !== 'ready' && this.state !== 'connecting') return false;

		const now = Date.now();
		if (text === this.#lastRejected.text && now - this.#lastRejected.at < NOTICE_REPEAT_MS) {
			return false;
		}

		try {
			await this.link.acceptRemote(text);
			this.scanned = true;
			this.notice = null;
			this.code = await this.link.verificationCode();
			return true;
		} catch (error) {
			this.#lastRejected = { text, at: now };
			if (
				error instanceof PacketDecodeError ||
				error instanceof SelfConnectionError ||
				(error instanceof LinkError && this.link.state !== 'failed')
			) {
				// 読み取り直せば済むものは、注意として出すだけにする
				this.notice = error.message;
			} else {
				this.error = error instanceof Error ? error.message : String(error);
			}
			return false;
		}
	}

	/** 相手にメッセージを送る */
	send(message: object): boolean {
		return this.link.send(JSON.stringify(message));
	}

	/** 手続きをやめる（つながっていれば切断する） */
	close(): void {
		this.link.close();
	}

	#onStateChange(state: LinkState): void {
		this.state = state;
		if (state === 'connected') {
			this.#wasConnected = true;
			this.#handlers.onOpen?.(this);
		} else if ((state === 'closed' || state === 'failed') && this.#wasConnected) {
			this.#wasConnected = false;
			this.#handlers.onEnd?.(this);
		}
	}
}
