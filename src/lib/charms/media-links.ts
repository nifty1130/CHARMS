/**
 * MediaLinks — 端末同士の映像接続をまとめて管理する
 *
 * 映像は「送る側（カメラ・テロップ）」と「受ける側（モニター・スイッチャー・ホスト）」が
 * 直接つながる。接続の打ち合わせ（SDP の交換）だけをホスト経由で行う。
 *
 * - 送る側: ホストから「この端末へ送って」と言われたら {@link offerTo} を呼ぶ
 * - 受ける側: 届いた打ち合わせを {@link handleSignal} に渡すと、映像が届き始める
 */

import { waitForGathering } from '$lib/rtc';
import { allowStereoReceive, AUDIO_MODES, DEFAULT_AUDIO_MODE, tuneOpusAnswer } from './audio';
import { QUALITY_PRESETS, THUMBNAIL } from './quality';
import type { AudioMode, LinkProfile, QualityId } from './protocol';

/** STUN / TURN を使わないときに、候補の収集を待つ最大時間（LAN 内なら通常は一瞬で終わる） */
const LAN_GATHERING_TIMEOUT_MS = 2000;

export interface MediaLinksOptions {
	/** 打ち合わせの内容を相手に届ける（ホスト経由） */
	sendSignal: (toId: string, description: RTCSessionDescriptionInit) => void;
	/** 受信中の映像の一覧が変わったとき */
	onStreams?: (streams: Record<string, MediaStream>) => void;
	/** 送信先の一覧が変わったとき */
	onTargets?: (targets: string[]) => void;
	/** 接続が切れたとき（ホストに知らせて張り直してもらう） */
	onFailed?: (sourceId: string | null, sinkId: string | null) => void;
	/**
	 * いま使える STUN / TURN サーバー（省略すると使わない＝同じ LAN 内だけでつながる）
	 *
	 * 接続を張るたびに呼ばれるので、認証情報の更新にも追従できる。
	 */
	iceServers?: () => RTCIceServer[];
}

interface Outgoing {
	pc: RTCPeerConnection;
	profile: LinkProfile;
	/** 映像の送り手（インカムでは null） */
	video: RTCRtpSender | null;
	audio: RTCRtpSender | null;
}

interface Incoming {
	pc: RTCPeerConnection;
	stream: MediaStream | null;
}

export class MediaLinks {
	readonly #options: MediaLinksOptions;
	readonly #outgoing = new Map<string, Outgoing>();
	readonly #incoming = new Map<string, Incoming>();
	#stream: MediaStream | null = null;
	#quality: QualityId = 'medium';
	#audioMode: AudioMode = DEFAULT_AUDIO_MODE;
	/** インカムで送る声（スイッチャーのマイク） */
	#talk: MediaStream | null = null;

	constructor(options: MediaLinksOptions) {
		this.#options = options;
	}

	/** いま映像を送っている相手の ID */
	get targets(): string[] {
		return [...this.#outgoing.keys()];
	}

	/**
	 * いま張っている映像接続の一覧（通信の状態を調べるときに使う）
	 *
	 * `direction` は、この端末から見て送っている（out）か、受けている（in）か。
	 */
	connections(): { peerId: string; direction: 'in' | 'out'; profile: LinkProfile | null; pc: RTCPeerConnection }[] {
		return [
			...[...this.#outgoing].map(([peerId, link]) => ({
				peerId,
				direction: 'out' as const,
				profile: link.profile,
				pc: link.pc
			})),
			...[...this.#incoming].map(([peerId, link]) => ({
				peerId,
				direction: 'in' as const,
				profile: null,
				pc: link.pc
			}))
		];
	}

	// ---- 送る側 ----

	/**
	 * 送り出す映像を設定する（差し替える）
	 *
	 * すでにつながっている相手には、接続を張り直さずに映像だけ差し替える。
	 * カメラの切り替えや画面共有のやり直しでも、相手の映像は途切れない。
	 */
	async setLocalStream(stream: MediaStream | null): Promise<void> {
		this.#stream = stream;
		const video = stream?.getVideoTracks()[0] ?? null;
		const audio = stream?.getAudioTracks()[0] ?? null;

		await Promise.all(
			[...this.#outgoing.values()].map(async (link) => {
				if (link.profile === 'talk' || !link.video) return;
				await link.video.replaceTrack(video).catch(() => {});
				await link.audio?.replaceTrack(audio).catch(() => {});
				await this.#applyEncoding(link, video);
			})
		);
	}

	/**
	 * インカムで送る声を設定する（スイッチャー用。やめるときは null）
	 *
	 * すでにつながっている相手には、接続を張り直さずに差し替える。
	 */
	async setTalkStream(stream: MediaStream | null): Promise<void> {
		this.#talk = stream;
		const voice = stream?.getAudioTracks()[0] ?? null;
		await Promise.all(
			[...this.#outgoing.values()]
				.filter((link) => link.profile === 'talk')
				.map((link) => link.audio?.replaceTrack(voice).catch(() => {}))
		);
	}

	/** 本番用映像の画質（ビットレートの上限）を変える */
	async setQuality(quality: QualityId): Promise<void> {
		this.#quality = quality;
		const video = this.#stream?.getVideoTracks()[0] ?? null;
		await Promise.all([...this.#outgoing.values()].map((link) => this.#applyEncoding(link, video)));
	}

	/**
	 * 音声の送り方（会話向け / 音楽向け）を変える
	 *
	 * 音声の圧縮の条件は接続を張るときに決まるので、音声を送っている相手とは接続を張り直す
	 * （相手の映像と音が一瞬途切れる）。
	 */
	async setAudioMode(mode: AudioMode): Promise<void> {
		if (this.#audioMode === mode) return;
		this.#audioMode = mode;
		await Promise.all(
			[...this.#outgoing]
				.filter(([, link]) => link.audio !== null && link.profile !== 'talk')
				.map(([targetId, link]) => this.offerTo(targetId, link.profile))
		);
	}

	/**
	 * 相手へ映像を送り始める（ホストから指示されたときに呼ぶ）
	 *
	 * @param targetId 送り先の端末の ID
	 * @param profile 確認用の小さな映像か、本番用の映像か
	 */
	async offerTo(targetId: string, profile: LinkProfile): Promise<void> {
		this.#closeOutgoing(targetId);

		const pc = this.#createConnection();
		const video = this.#stream?.getVideoTracks()[0] ?? null;
		const audio = this.#stream?.getAudioTracks()[0] ?? null;

		// 映像と音声を、受ける側で1つのストリームとして扱えるようにまとめる
		const group = new MediaStream();
		let videoSender: RTCRtpSender | null = null;
		let audioSender: RTCRtpSender | null = null;
		if (profile === 'talk') {
			// インカム: スイッチャーのマイクの声だけを送る
			const voice = this.#talk?.getAudioTracks()[0] ?? null;
			audioSender = pc.addTransceiver(voice ?? 'audio', {
				direction: 'sendonly',
				streams: [group],
				sendEncodings: [{ maxBitrate: AUDIO_MODES.voice.maxBitrate }]
			}).sender;
		} else {
			videoSender = pc.addTransceiver(video ?? 'video', {
				direction: 'sendonly',
				streams: [group],
				sendEncodings: [this.#encoding(profile, video)]
			}).sender;
			// 確認用の映像には音声を付けない（負荷と帯域の節約）
			if (profile === 'program') {
				audioSender = pc.addTransceiver(audio ?? 'audio', {
					direction: 'sendonly',
					streams: [group],
					sendEncodings: [{ maxBitrate: AUDIO_MODES[this.#audioMode].maxBitrate }]
				}).sender;
			}
		}

		const link: Outgoing = { pc, profile, video: videoSender, audio: audioSender };
		this.#outgoing.set(targetId, link);
		this.#options.onTargets?.(this.targets);

		pc.onconnectionstatechange = () => {
			if (pc.connectionState !== 'failed' || this.#outgoing.get(targetId) !== link) return;
			this.#closeOutgoing(targetId);
			this.#options.onFailed?.(null, targetId);
		};

		try {
			await pc.setLocalDescription(await pc.createOffer());
			await gather(pc);
			if (this.#outgoing.get(targetId) !== link || !pc.localDescription) return;
			this.#options.sendSignal(targetId, pc.localDescription.toJSON());
		} catch {
			if (this.#outgoing.get(targetId) !== link) return;
			this.#closeOutgoing(targetId);
			this.#options.onFailed?.(null, targetId);
		}
	}

	// ---- 送る側・受ける側 共通 ----

	/**
	 * ホスト経由で届いた打ち合わせを処理する
	 *
	 * - Offer（映像を送りたい）が届いたら、受け取る準備をして Answer を返す
	 * - Answer（受け取れます）が届いたら、送信を始める
	 */
	async handleSignal(fromId: string, description: RTCSessionDescriptionInit): Promise<void> {
		if (description.type === 'answer') {
			const link = this.#outgoing.get(fromId);
			if (!link || link.pc.signalingState !== 'have-local-offer') return;
			try {
				// 音声を送る接続では、相手の条件を「いまの音声の送り方」に合わせて読み替える
				const sdp =
					link.audio && description.sdp
						? tuneOpusAnswer(description.sdp, link.profile === 'talk' ? 'voice' : this.#audioMode)
						: description.sdp;
				await link.pc.setRemoteDescription({ type: 'answer', sdp });
			} catch {
				if (this.#outgoing.get(fromId) !== link) return;
				this.#closeOutgoing(fromId);
				this.#options.onFailed?.(null, fromId);
			}
			return;
		}
		if (description.type !== 'offer') return;

		this.#closeIncoming(fromId);
		const pc = this.#createConnection();
		const link: Incoming = { pc, stream: null };
		this.#incoming.set(fromId, link);

		pc.ontrack = (event) => {
			if (this.#incoming.get(fromId) !== link) return;
			const stream = event.streams[0] ?? link.stream ?? new MediaStream();
			if (!event.streams[0]) stream.addTrack(event.track);
			if (link.stream !== stream) {
				link.stream = stream;
				this.#emitStreams();
			}
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState !== 'failed' || this.#incoming.get(fromId) !== link) return;
			this.#closeIncoming(fromId);
			this.#emitStreams();
			this.#options.onFailed?.(fromId, null);
		};

		try {
			await pc.setRemoteDescription(description);
			const answer = await pc.createAnswer();
			try {
				// 音楽向けの音声をステレオで受け取れるように、その旨を Answer に書き足す
				await pc.setLocalDescription({ type: 'answer', sdp: allowStereoReceive(answer.sdp ?? '') });
			} catch {
				// 書き足しを受け付けないブラウザでは、そのままの Answer を使う（モノラルで受け取る）
				await pc.setLocalDescription(answer);
			}
			await gather(pc);
			if (this.#incoming.get(fromId) !== link || !pc.localDescription) return;
			this.#options.sendSignal(fromId, pc.localDescription.toJSON());
		} catch {
			if (this.#incoming.get(fromId) !== link) return;
			this.#closeIncoming(fromId);
			this.#emitStreams();
			this.#options.onFailed?.(fromId, null);
		}
	}

	/** 相手との映像接続を切る（送信・受信の両方） */
	drop(peerId: string): void {
		this.#closeOutgoing(peerId);
		if (this.#closeIncoming(peerId)) this.#emitStreams();
	}

	/** すべての映像接続を切る */
	closeAll(): void {
		for (const id of [...this.#outgoing.keys()]) this.#closeOutgoing(id);
		const hadIncoming = this.#incoming.size > 0;
		for (const id of [...this.#incoming.keys()]) this.#closeIncoming(id);
		if (hadIncoming) this.#emitStreams();
	}

	// ---- 内部処理 ----

	#createConnection(): RTCPeerConnection {
		return new RTCPeerConnection({ iceServers: this.#options.iceServers?.() ?? [] });
	}

	#closeOutgoing(targetId: string): void {
		const link = this.#outgoing.get(targetId);
		if (!link) return;
		this.#outgoing.delete(targetId);
		link.pc.onconnectionstatechange = null;
		link.pc.close();
		this.#options.onTargets?.(this.targets);
	}

	#closeIncoming(sourceId: string): boolean {
		const link = this.#incoming.get(sourceId);
		if (!link) return false;
		this.#incoming.delete(sourceId);
		link.pc.onconnectionstatechange = null;
		link.pc.ontrack = null;
		link.pc.close();
		return true;
	}

	#emitStreams(): void {
		const streams: Record<string, MediaStream> = {};
		for (const [id, link] of this.#incoming) {
			if (link.stream) streams[id] = link.stream;
		}
		this.#options.onStreams?.(streams);
	}

	/** 送り方に応じた圧縮の設定を作る */
	#encoding(profile: LinkProfile, video: MediaStreamTrack | null): RTCRtpEncodingParameters {
		if (profile === 'program') {
			return { maxBitrate: QUALITY_PRESETS[this.#quality].maxBitrate };
		}
		const height = video?.getSettings().height ?? THUMBNAIL.height;
		return {
			maxBitrate: THUMBNAIL.maxBitrate,
			maxFramerate: THUMBNAIL.frameRate,
			scaleResolutionDownBy: Math.max(1, height / THUMBNAIL.height)
		};
	}

	async #applyEncoding(link: Outgoing, video: MediaStreamTrack | null): Promise<void> {
		if (!link.video) return;
		try {
			const parameters = link.video.getParameters();
			if (!parameters.encodings?.length) return;
			Object.assign(parameters.encodings[0], this.#encoding(link.profile, video));
			await link.video.setParameters(parameters);
		} catch {
			// 設定の変更に対応していないブラウザでは、初期設定のまま送り続ける
		}
	}
}

/** 候補が出そろうのを待つ（STUN / TURN を使わないときは、短い時間で切り上げる） */
function gather(pc: RTCPeerConnection): Promise<void> {
	const usesServers = (pc.getConfiguration().iceServers ?? []).length > 0;
	return waitForGathering(pc, usesServers ? {} : { timeoutMs: LAN_GATHERING_TIMEOUT_MS });
}
