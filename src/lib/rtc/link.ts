/**
 * PeerLink — QR コードだけで2台の端末を DataChannel でつなぐ
 *
 * 使い方（両方の端末で同じ手順）:
 *
 * ```typescript
 * const link = new PeerLink({ onOpen: (channel) => channel.send('こんにちは') });
 * await link.prepare();              // 1. 自分の接続情報を集める
 * showQr(link.qrText);               // 2. QR として表示する
 * await link.acceptRemote(scanned);  // 3. 相手の QR を読み取った文字列を渡す
 * ```
 *
 * どちらが先に読み取っても構わない。両方が相手の QR を読み取った時点で開通する。
 *
 * 仕組み: 両方の端末が Offer を作り、互いに「相手は Answer を返した」ことにして接続する。
 * DTLS の役割はフィンガープリントの大小で決めるので、事前の打ち合わせは要らない。
 * ブラウザが作った SDP は書き換えない。
 *
 * STUN / TURN サーバーは既定では使わない（同じ LAN 内だけでつながる）。
 * `prepare({ iceServers })` で渡すと、別のネットワークにいる端末ともつながるようになる。
 */

import {
	CHANNEL_ID,
	CHANNEL_LABEL,
	DEFAULT_CONNECT_TIMEOUT_MS,
	DEFAULT_MAX_CANDIDATES
} from './constants';
import { LinkError, LinkTimeoutError, SelfConnectionError } from './errors';
import { compareFingerprints, generateVerificationCode } from './fingerprint';
import { waitForGathering } from './gathering';
import { decodePacket, packetFromQrText, packetToQrText } from './packet';
import {
	buildCandidateInit,
	buildRemoteAnswer,
	parseLocalDescription,
	selectCandidates,
	type LocalDescriptionInfo
} from './sdp';
import type { LinkState, PeerLinkOptions, SignalPacket } from './types';

export class PeerLink {
	#pc: RTCPeerConnection | null = null;
	#channel: RTCDataChannel | null = null;
	#state: LinkState = 'idle';
	#local: LocalDescriptionInfo | null = null;
	#remote: SignalPacket | null = null;
	#qrText = '';
	#connectTimer: ReturnType<typeof setTimeout> | undefined;
	#opened: Promise<RTCDataChannel>;
	#resolveOpened!: (channel: RTCDataChannel) => void;
	#rejectOpened!: (error: Error) => void;

	readonly #options: PeerLinkOptions;

	constructor(options: PeerLinkOptions = {}) {
		this.#options = options;
		this.#opened = new Promise((resolve, reject) => {
			this.#resolveOpened = resolve;
			this.#rejectOpened = reject;
		});
		// opened() を使わない場合に「未処理の Promise 拒否」警告が出ないようにする
		this.#opened.catch(() => {});
	}

	/** 現在の状態 */
	get state(): LinkState {
		return this.#state;
	}

	/** QR コードに入れる文字列（`prepare()` の完了後に使える） */
	get qrText(): string {
		if (!this.#qrText) {
			throw new LinkError('先に prepare() を呼んでください', this.#state);
		}
		return this.#qrText;
	}

	/** 開通した DataChannel（開通前は null） */
	get channel(): RTCDataChannel | null {
		return this.#channel?.readyState === 'open' ? this.#channel : null;
	}

	/** 内部の RTCPeerConnection（接続状態の調査用） */
	get peerConnection(): RTCPeerConnection | null {
		return this.#pc;
	}

	/**
	 * 自分の接続情報を集めて、QR を表示できる状態にする
	 *
	 * @param rtcConfig RTCPeerConnection に渡す設定（STUN / TURN サーバーなど）。省略すると LAN 内だけでつながる
	 * @throws {@link LinkError} すでに呼び出し済み、または接続情報を集められなかった場合
	 */
	async prepare(rtcConfig: RTCConfiguration = {}): Promise<void> {
		if (this.#state !== 'idle') {
			throw new LinkError('prepare() は1回だけ呼べます', this.#state);
		}
		this.#setState('gathering');

		try {
			const pc = new RTCPeerConnection({
				iceServers: [],
				...this.#options.rtcConfig,
				...rtcConfig
			});
			this.#pc = pc;

			// 両端で同じ ID を指定する「negotiated」チャネル。どちらも同じ手順で作れる
			const channel = pc.createDataChannel(CHANNEL_LABEL, {
				negotiated: true,
				id: CHANNEL_ID,
				ordered: true
			});
			this.#channel = channel;
			this.#watchChannel(channel);
			this.#watchConnection(pc);

			await pc.setLocalDescription(await pc.createOffer());
			await waitForGathering(pc);
			if (this.#isClosed()) return;

			const info = parseLocalDescription(pc.localDescription?.sdp ?? '');
			if (!info) {
				throw new LinkError('ブラウザから接続情報を取得できませんでした', this.#state);
			}
			info.candidates = selectCandidates(
				info.candidates,
				this.#options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
			);
			if (info.candidates.length === 0) {
				throw new LinkError(
					'ネットワークが見つかりません。Wi-Fi または有線 LAN につながっているか確認してください',
					this.#state
				);
			}

			this.#local = info;
			this.#qrText = packetToQrText(info);
			this.#setState('ready');
		} catch (error) {
			this.#fail(error);
			throw error;
		}
	}

	/**
	 * 相手の QR から読み取った内容を渡して、接続を始める
	 *
	 * 同じ相手の QR を何度渡してもよい（QR リーダーは同じコードを連続で読むため）。
	 *
	 * @param input QR から読み取った文字列、またはパケットのバイト列
	 * @throws {@link PacketDecodeError} CHARMS の QR ではない場合
	 * @throws {@link SelfConnectionError} 自分の QR を読み取った場合
	 * @throws {@link LinkError} 呼び出せない状態、または別の相手をすでに読み取り済みの場合
	 */
	async acceptRemote(input: string | Uint8Array): Promise<void> {
		const remote = typeof input === 'string' ? packetFromQrText(input) : decodePacket(input);

		const pc = this.#pc;
		const local = this.#local;
		if (!pc || !local || (this.#state !== 'ready' && !this.#remote)) {
			throw new LinkError('まだ相手の QR を読み取れる状態ではありません', this.#state);
		}

		const order = compareFingerprints(local.fingerprint, remote.fingerprint);
		if (order === 0) {
			throw new SelfConnectionError(this.#state);
		}
		if (this.#remote) {
			if (compareFingerprints(this.#remote.fingerprint, remote.fingerprint) === 0) return;
			throw new LinkError(
				'すでに別の端末の QR を読み取っています。やり直す場合は最初からやり直してください',
				this.#state
			);
		}
		if (remote.candidates.length === 0) {
			throw new LinkError('相手の QR に接続先の情報が含まれていません', this.#state);
		}

		this.#remote = remote;
		this.#setState('connecting');

		try {
			// フィンガープリントが大きい方が DTLS のサーバー役（＝相手は active）
			await pc.setRemoteDescription({
				type: 'answer',
				sdp: buildRemoteAnswer(remote, order > 0 ? 'active' : 'passive', local.mid)
			});

			let added = 0;
			for (const [index, candidate] of remote.candidates.entries()) {
				try {
					await pc.addIceCandidate(buildCandidateInit(candidate, index, local.mid));
					added++;
				} catch {
					// このブラウザで扱えない候補は飛ばす（他の候補でつながれば問題ない）
				}
			}
			if (added === 0) {
				throw new LinkError('相手の接続先の情報を読み込めませんでした', this.#state);
			}
		} catch (error) {
			this.#fail(error);
			throw error;
		}

		const timeout = this.#options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		if (timeout > 0 && this.#state === 'connecting') {
			this.#connectTimer = setTimeout(() => {
				if (this.#state === 'connecting') this.#fail(new LinkTimeoutError(this.#state));
			}, timeout);
		}
	}

	/**
	 * DataChannel が開通するまで待つ
	 *
	 * @returns 開通した DataChannel
	 * @throws 接続に失敗した、または開通前に閉じられた場合
	 */
	opened(): Promise<RTCDataChannel> {
		return this.#opened;
	}

	/**
	 * 相手にメッセージを送る
	 *
	 * @returns 送信できたら true、未開通なら false
	 */
	send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): boolean {
		const channel = this.channel;
		if (!channel) return false;
		// send() は引数の型ごとにオーバーロードされているので、文字列だけ分けて呼ぶ
		if (typeof data === 'string') channel.send(data);
		else channel.send(data as ArrayBuffer);
		return true;
	}

	/**
	 * 4桁の確認コードを返す
	 *
	 * 両方の端末で同じ数字になる。見比べることで、正しい相手とつながったことを確かめられる。
	 *
	 * @returns 確認コード。相手の QR を読み取る前は null
	 */
	async verificationCode(): Promise<string | null> {
		if (!this.#local || !this.#remote) return null;
		return generateVerificationCode(this.#local.fingerprint, this.#remote.fingerprint);
	}

	/** 接続を終了して後片付けをする */
	close(): void {
		if (this.#isClosed()) return;
		this.#teardown();
		this.#setState('closed');
		this.#rejectOpened(new LinkError('接続を終了しました', 'closed'));
	}

	// ---- 内部処理 ----

	#isClosed(): boolean {
		return this.#state === 'closed' || this.#state === 'failed';
	}

	#setState(state: LinkState): void {
		if (this.#state === state) return;
		this.#state = state;
		this.#options.onStateChange?.(state);
	}

	#teardown(): void {
		clearTimeout(this.#connectTimer);
		if (this.#channel) {
			this.#channel.onopen = null;
			this.#channel.onclose = null;
			this.#channel.onmessage = null;
			this.#channel.close();
		}
		if (this.#pc) {
			this.#pc.onconnectionstatechange = null;
			this.#pc.close();
		}
	}

	#fail(cause: unknown): void {
		if (this.#isClosed()) return;
		const error = cause instanceof Error ? cause : new LinkError(String(cause), this.#state);
		this.#teardown();
		this.#setState('failed');
		this.#rejectOpened(error);
		this.#options.onError?.(error);
	}

	#watchChannel(channel: RTCDataChannel): void {
		channel.binaryType = 'arraybuffer';

		channel.onopen = () => {
			clearTimeout(this.#connectTimer);
			this.#setState('connected');
			this.#resolveOpened(channel);
			this.#options.onOpen?.(channel);
		};

		channel.onmessage = (event) => {
			this.#options.onMessage?.(event.data);
		};

		channel.onclose = () => {
			if (this.#state === 'connected') {
				// 相手が接続を終了した
				this.#teardown();
				this.#setState('closed');
			}
		};
	}

	#watchConnection(pc: RTCPeerConnection): void {
		pc.onconnectionstatechange = () => {
			// 'disconnected' は一時的な途切れで自動復旧することがあるので、'failed' だけを扱う
			if (pc.connectionState !== 'failed') return;
			this.#fail(
				new LinkError(
					this.#state === 'connected'
						? '相手との接続が切れました'
						: '相手の端末に届きませんでした。両方の端末が同じネットワークにつながっているか、インターネットにつながっているかを確認してください',
					this.#state
				)
			);
		};
	}
}
