/**
 * MediaLinks — 端末同士の映像接続をまとめて管理する
 *
 * 映像は「送る側（カメラ・テロップ）」と「受ける側（モニター・スイッチャー・ホスト）」が
 * 直接つながる。接続の打ち合わせ（SDP の交換）だけをホスト経由で行う。
 *
 * - 送る側: ホストから「この端末へ送って」と言われたら {@link offerTo} を呼ぶ
 * - 受ける側: 届いた打ち合わせを {@link handleSignal} に渡すと、映像が届き始める
 */

import { QUALITY_PRESETS, THUMBNAIL } from './quality';
import type { LinkProfile, QualityId } from './protocol';

/** 候補の収集を待つ最大時間（LAN 内なら通常は一瞬で終わる） */
const GATHERING_TIMEOUT_MS = 2000;

export interface MediaLinksOptions {
	/** 打ち合わせの内容を相手に届ける（ホスト経由） */
	sendSignal: (toId: string, description: RTCSessionDescriptionInit) => void;
	/** 受信中の映像の一覧が変わったとき */
	onStreams?: (streams: Record<string, MediaStream>) => void;
	/** 送信先の一覧が変わったとき */
	onTargets?: (targets: string[]) => void;
	/** 接続が切れたとき（ホストに知らせて張り直してもらう） */
	onFailed?: (sourceId: string | null, sinkId: string | null) => void;
}

interface Outgoing {
	pc: RTCPeerConnection;
	profile: LinkProfile;
	video: RTCRtpSender;
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

	constructor(options: MediaLinksOptions) {
		this.#options = options;
	}

	/** いま映像を送っている相手の ID */
	get targets(): string[] {
		return [...this.#outgoing.keys()];
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
				await link.video.replaceTrack(video).catch(() => {});
				await link.audio?.replaceTrack(audio).catch(() => {});
				await this.#applyEncoding(link, video);
			})
		);
	}

	/** 本番用映像の画質（ビットレートの上限）を変える */
	async setQuality(quality: QualityId): Promise<void> {
		this.#quality = quality;
		const video = this.#stream?.getVideoTracks()[0] ?? null;
		await Promise.all([...this.#outgoing.values()].map((link) => this.#applyEncoding(link, video)));
	}

	/**
	 * 相手へ映像を送り始める（ホストから指示されたときに呼ぶ）
	 *
	 * @param targetId 送り先の端末の ID
	 * @param profile 確認用の小さな映像か、本番用の映像か
	 */
	async offerTo(targetId: string, profile: LinkProfile): Promise<void> {
		this.#closeOutgoing(targetId);

		const pc = new RTCPeerConnection({ iceServers: [] });
		const video = this.#stream?.getVideoTracks()[0] ?? null;
		const audio = this.#stream?.getAudioTracks()[0] ?? null;

		// 映像と音声を、受ける側で1つのストリームとして扱えるようにまとめる
		const group = new MediaStream();
		const videoTransceiver = pc.addTransceiver(video ?? 'video', {
			direction: 'sendonly',
			streams: [group],
			sendEncodings: [this.#encoding(profile, video)]
		});
		// 確認用の映像には音声を付けない（負荷と帯域の節約）
		const audioTransceiver =
			profile === 'program'
				? pc.addTransceiver(audio ?? 'audio', { direction: 'sendonly', streams: [group] })
				: null;

		const link: Outgoing = {
			pc,
			profile,
			video: videoTransceiver.sender,
			audio: audioTransceiver?.sender ?? null
		};
		this.#outgoing.set(targetId, link);
		this.#options.onTargets?.(this.targets);

		pc.onconnectionstatechange = () => {
			if (pc.connectionState !== 'failed' || this.#outgoing.get(targetId) !== link) return;
			this.#closeOutgoing(targetId);
			this.#options.onFailed?.(null, targetId);
		};

		try {
			await pc.setLocalDescription(await pc.createOffer());
			await waitForGathering(pc);
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
				await link.pc.setRemoteDescription(description);
			} catch {
				if (this.#outgoing.get(fromId) !== link) return;
				this.#closeOutgoing(fromId);
				this.#options.onFailed?.(null, fromId);
			}
			return;
		}
		if (description.type !== 'offer') return;

		this.#closeIncoming(fromId);
		const pc = new RTCPeerConnection({ iceServers: [] });
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
			await pc.setLocalDescription(await pc.createAnswer());
			await waitForGathering(pc);
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

/** ICE 候補の収集が終わるまで待つ（時間切れでも、集まった分で先へ進む） */
function waitForGathering(pc: RTCPeerConnection): Promise<void> {
	if (pc.iceGatheringState === 'complete') return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			pc.removeEventListener('icegatheringstatechange', onChange);
			resolve();
		};
		const onChange = () => {
			if (pc.iceGatheringState === 'complete') done();
		};
		const timer = setTimeout(done, GATHERING_TIMEOUT_MS);
		pc.addEventListener('icegatheringstatechange', onChange);
	});
}
