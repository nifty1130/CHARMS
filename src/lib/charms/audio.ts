/**
 * 音声の設定
 *
 * ブラウザは、マイクの音を「会話」向けに加工する（雑音を消す、音量をそろえる、
 * スピーカーの音の回り込みを消す）。会話には都合がよいが、音楽では、音が途切れたり
 * こもったりする原因になる。演奏や歌を送るときのために、加工を切る「音楽向け」を用意する。
 */

import type { AudioMode } from './protocol';

export const DEFAULT_AUDIO_MODE: AudioMode = 'voice';

export const AUDIO_MODES: Record<AudioMode, { label: string; detail: string; maxBitrate: number }> = {
	voice: {
		label: '会話向け',
		detail: '雑音を抑えて、声を聞き取りやすくする',
		maxBitrate: 64_000
	},
	music: {
		label: '音楽向け',
		detail: '加工をせず、高音質・ステレオで送る',
		maxBitrate: 256_000
	}
};

export const AUDIO_MODE_ORDER: AudioMode[] = ['voice', 'music'];

/**
 * マイクを開くときの条件を作る
 *
 * @param mode 会話向けか、音楽向けか
 * @param deviceId 使うマイク（省略すると、ブラウザの既定のマイク）
 */
export function audioConstraints(mode: AudioMode, deviceId?: string): MediaTrackConstraints {
	const device = deviceId ? { deviceId: { exact: deviceId } } : {};
	if (mode === 'music') {
		return {
			...device,
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: { ideal: 2 },
			sampleRate: { ideal: 48_000 }
		};
	}
	return { ...device, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

/** SDP の中から、Opus の設定行（a=fmtp）を書き換える */
function rewriteOpusFmtp(sdp: string, rewrite: (params: Map<string, string>) => void): string {
	const payload = /^a=rtpmap:(\d+) opus\/48000/im.exec(sdp)?.[1];
	if (!payload) return sdp;

	const pattern = new RegExp(`^a=fmtp:${payload} (.*)$`, 'm');
	const current = pattern.exec(sdp);
	const params = new Map<string, string>();
	for (const part of (current?.[1] ?? '').trim().split(';')) {
		const [key, value = ''] = part.trim().split('=');
		if (key) params.set(key, value);
	}
	rewrite(params);
	const line = `a=fmtp:${payload} ${[...params].map(([key, value]) => `${key}=${value}`).join(';')}`;

	if (current) return sdp.replace(pattern, line);
	// 設定行がない場合は、コーデックの宣言の直後に足す
	return sdp.replace(new RegExp(`^(a=rtpmap:${payload} opus/48000.*)$`, 'm'), `$1\r\n${line}`);
}

/**
 * 受ける側: 「ステレオで受け取れます」と相手に伝える
 *
 * 自分が作った Answer に `stereo=1` を足す。送る側が会話向けのときは、送る側がこれを無視する。
 */
export function allowStereoReceive(sdp: string): string {
	return rewriteOpusFmtp(sdp, (params) => {
		params.set('stereo', '1');
	});
}

/**
 * 送る側: 相手から届いた Answer を、音声の設定に合わせて読み替える
 *
 * ブラウザは、相手の Answer に書かれた条件に従って音声を圧縮する。
 * 音楽向けではステレオ・高ビットレートで、会話向けではモノラルで送るように読み替える。
 * （自分が作った SDP は書き換えない）
 */
export function tuneOpusAnswer(sdp: string, mode: AudioMode): string {
	return rewriteOpusFmtp(sdp, (params) => {
		if (mode === 'music') {
			params.set('stereo', '1');
			params.set('sprop-stereo', '1');
			params.set('maxaveragebitrate', String(AUDIO_MODES.music.maxBitrate));
			// 無音のときに送信を止める機能は、演奏の小さな音を切ってしまうので使わない
			params.delete('usedtx');
		} else {
			params.delete('stereo');
			params.delete('sprop-stereo');
			params.delete('maxaveragebitrate');
		}
	});
}

/**
 * 音量メーター
 *
 * マイクに音が入っているかを、画面で確かめられるようにする。
 * 音量は 0（無音）〜 1（最大）で通知する。
 */
export class LevelMeter {
	#context: AudioContext | null = null;
	#source: MediaStreamAudioSourceNode | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;

	/**
	 * @param stream 測る音声（音声トラックがなければ、何もしない）
	 * @param onLevel 音量が変わるたびに呼ばれる（1秒に約15回）
	 */
	constructor(stream: MediaStream, onLevel: (level: number) => void) {
		const track = stream.getAudioTracks()[0];
		const Context = globalThis.AudioContext;
		if (!track || !Context) return;

		try {
			const context = new Context();
			const analyser = context.createAnalyser();
			analyser.fftSize = 1024;
			const source = context.createMediaStreamSource(new MediaStream([track]));
			source.connect(analyser);
			this.#context = context;
			this.#source = source;

			const samples = new Float32Array(analyser.fftSize);
			let shown = 0;
			this.#timer = setInterval(() => {
				// 画面を操作するまで音声の処理を始められないブラウザがあるので、止まっていたら再開を試みる
				if (context.state === 'suspended') void context.resume().catch(() => {});
				analyser.getFloatTimeDomainData(samples);
				let peak = 0;
				for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
				// 人の耳の感じ方に近づけるため、デシベル（-60dB〜0dB）に直してから 0〜1 にする
				const level = peak > 0 ? Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / 60)) : 0;
				// 上がるときはすぐに、下がるときはゆっくり動かす（針が読みやすい）
				shown = level > shown ? level : shown * 0.85 + level * 0.15;
				onLevel(shown);
			}, 66);
		} catch {
			this.destroy();
		}
	}

	destroy(): void {
		clearInterval(this.#timer);
		this.#source?.disconnect();
		void this.#context?.close().catch(() => {});
		this.#source = null;
		this.#context = null;
	}
}
