/**
 * ルーム（合言葉）との通信
 *
 * インターネットにつながっているときは、QR コードを読み取り合う代わりに、
 * 配信元の「ルーム」を通して接続情報の文字列を受け渡せる。
 * ホストが合言葉（6桁の数字）でルームを開き、端末は合言葉か招待リンクで参加する。
 *
 * ここを通るのは最初の接続情報だけ。つながったあとの操作や映像は、端末同士が直接やり取りする。
 */

import { base } from '$app/paths';

/** ルームから届くメッセージ（worker/room-logic.ts の RoomServerMessage と同じ） */
export type RoomMessage =
	| { type: 'host'; present: boolean }
	| { type: 'join'; peer: string; packet: string }
	| { type: 'leave'; peer: string }
	| { type: 'answer'; packet: string }
	| { type: 'reject'; reason: string }
	| { type: 'error'; reason: string };

/**
 * ルームとのつながり具合
 *
 * - `connecting`: つなごうとしている
 * - `open`: つながっている
 * - `offline`: 届かない（インターネットがない、など）。間をあけて自動で試し直す
 * - `refused`: 断られた（合言葉が使用中、満員、別の画面に入れ替わった）。試し直さない
 */
export type RoomStatus = 'connecting' | 'open' | 'offline' | 'refused';

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 20_000;
/** 接続を保つための合図を送る間隔 */
const PING_INTERVAL_MS = 25_000;
/** つながるまで待つ最大時間 */
const OPEN_TIMEOUT_MS = 8000;

/** 合言葉を作る（6桁の数字） */
export function generateRoomCode(): string {
	const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	return value.toString().padStart(6, '0');
}

/** 推測できない文字列を作る（ホストの鍵、端末の復帰用の合図に使う） */
export function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 入力された合言葉を整える
 *
 * 全角の数字や、区切りの空白・ハイフンが入っていても受け付ける。
 *
 * @returns 6桁の数字。形式が違えば null
 */
export function normalizeRoomCode(text: string | null | undefined): string | null {
	if (!text) return null;
	const digits = text
		.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
		.replace(/[\s\-‐－ー]/g, '');
	return /^\d{6}$/.test(digits) ? digits : null;
}

/** 合言葉を読みやすく区切る（123 456） */
export function formatRoomCode(code: string): string {
	return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * 招待リンクを作る
 *
 * @param code 合言葉
 * @param path 開くページ（既定はトップページ。'/monitor/' などを指定すると役割を選ばずに済む）
 * @param params リンクに付ける追加の指定
 */
export function inviteUrl(code: string, path = '/', params: Record<string, string> = {}): string {
	const url = new URL(`${base}${path}`, location.origin);
	url.searchParams.set('room', code);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url.href;
}

export interface RoomSocketOptions {
	code: string;
	as: 'host' | 'node';
	/** ホストの鍵（ホストのみ） */
	key?: string;
	onMessage: (message: RoomMessage) => void;
	onStatus?: (status: RoomStatus, reason?: string) => void;
}

/**
 * ルームへの WebSocket 接続
 *
 * 切れたら間をあけて自動でつなぎ直す。断られたとき（`refused`）と、{@link close} したあとは試し直さない。
 */
export class RoomSocket {
	readonly code: string;
	readonly #options: RoomSocketOptions;
	#socket: WebSocket | null = null;
	#status: RoomStatus = 'connecting';
	#closed = false;
	#retryMs = RETRY_MIN_MS;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#openTimer: ReturnType<typeof setTimeout> | undefined;
	#pingTimer: ReturnType<typeof setInterval> | undefined;

	constructor(options: RoomSocketOptions) {
		this.code = options.code;
		this.#options = options;
		this.#connect();
	}

	get status(): RoomStatus {
		return this.#status;
	}

	/** メッセージを送る。つながっていなければ false */
	send(message: object): boolean {
		if (this.#socket?.readyState !== WebSocket.OPEN) return false;
		this.#socket.send(JSON.stringify(message));
		return true;
	}

	/** 接続を終了する */
	close(): void {
		this.#closed = true;
		this.#cleanup();
		this.#socket?.close(1000);
		this.#socket = null;
	}

	#setStatus(status: RoomStatus, reason?: string): void {
		if (this.#status === status && !reason) return;
		this.#status = status;
		this.#options.onStatus?.(status, reason);
	}

	#cleanup(): void {
		clearTimeout(this.#retryTimer);
		clearTimeout(this.#openTimer);
		clearInterval(this.#pingTimer);
	}

	#connect(): void {
		if (this.#closed) return;
		this.#cleanup();

		const url = new URL(`${base}/api/room/${this.code}`, location.origin);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		url.searchParams.set('as', this.#options.as);
		if (this.#options.key) url.searchParams.set('key', this.#options.key);

		let socket: WebSocket;
		try {
			socket = new WebSocket(url);
		} catch {
			this.#retryLater();
			return;
		}
		this.#socket = socket;
		let refused = false;

		this.#openTimer = setTimeout(() => socket.close(), OPEN_TIMEOUT_MS);

		socket.onopen = () => {
			if (this.#socket !== socket) return;
			clearTimeout(this.#openTimer);
			this.#retryMs = RETRY_MIN_MS;
			this.#setStatus('open');
			this.#pingTimer = setInterval(() => {
				if (socket.readyState === WebSocket.OPEN) socket.send('ping');
			}, PING_INTERVAL_MS);
		};

		socket.onmessage = (event) => {
			if (this.#socket !== socket || typeof event.data !== 'string' || event.data === 'pong') return;
			let message: RoomMessage;
			try {
				message = JSON.parse(event.data) as RoomMessage;
			} catch {
				return;
			}
			if (typeof message !== 'object' || message === null) return;
			if (message.type === 'error') {
				refused = true;
				this.#closed = true;
				this.#cleanup();
				this.#setStatus('refused', message.reason);
				return;
			}
			this.#options.onMessage(message);
		};

		socket.onclose = (event) => {
			if (this.#socket !== socket) return;
			this.#socket = null;
			this.#cleanup();
			if (this.#closed || refused) return;
			if (event.code === 4000) {
				// 同じホストが別の画面で開かれ、そちらに入れ替わった
				this.#closed = true;
				this.#setStatus('refused', 'replaced');
				return;
			}
			this.#retryLater();
		};
	}

	#retryLater(): void {
		if (this.#closed) return;
		this.#setStatus('offline');
		this.#retryTimer = setTimeout(() => {
			this.#setStatus('connecting');
			this.#connect();
		}, this.#retryMs);
		this.#retryMs = Math.min(this.#retryMs * 2, RETRY_MAX_MS);
	}
}
