import { describe, expect, it } from 'vitest';
import { allowStereoReceive, audioConstraints, tuneOpusAnswer } from './audio';

/** Chrome が作る Answer の、音声の部分（抜粋） */
const ANSWER = [
	'v=0',
	'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
	'a=rtpmap:111 opus/48000/2',
	'a=rtcp-fb:111 transport-cc',
	'a=fmtp:111 minptime=10;useinbandfec=1',
	'a=rtpmap:63 red/48000/2',
	'a=fmtp:63 111/111',
	'm=video 9 UDP/TLS/RTP/SAVPF 96',
	'a=rtpmap:96 VP8/90000',
	''
].join('\r\n');

const fmtp = (sdp: string) => /^a=fmtp:111 (.*)$/m.exec(sdp)?.[1] ?? '';

describe('audioConstraints', () => {
	it('会話向けは、雑音を抑える加工を使う', () => {
		expect(audioConstraints('voice')).toEqual({
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true
		});
	});

	it('音楽向けは、加工をすべて切り、ステレオを求める', () => {
		expect(audioConstraints('music')).toMatchObject({
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: { ideal: 2 }
		});
	});

	it('マイクを指定できる', () => {
		expect(audioConstraints('voice', 'mic-1').deviceId).toEqual({ exact: 'mic-1' });
		expect(audioConstraints('music', 'mic-1').deviceId).toEqual({ exact: 'mic-1' });
	});
});

describe('tuneOpusAnswer', () => {
	it('音楽向けでは、ステレオ・高ビットレートで送るように読み替える', () => {
		const tuned = fmtp(tuneOpusAnswer(ANSWER, 'music'));
		expect(tuned).toContain('stereo=1');
		expect(tuned).toContain('sprop-stereo=1');
		expect(tuned).toContain('maxaveragebitrate=256000');
		// もとの設定は残す
		expect(tuned).toContain('useinbandfec=1');
	});

	it('会話向けでは、相手がステレオを受け取れても、モノラルで送る', () => {
		const stereo = allowStereoReceive(ANSWER);
		expect(fmtp(stereo)).toContain('stereo=1');
		const tuned = fmtp(tuneOpusAnswer(stereo, 'voice'));
		expect(tuned).not.toContain('stereo');
		expect(tuned).toContain('minptime=10');
	});

	it('ほかのコーデックの行は変えない', () => {
		const tuned = tuneOpusAnswer(ANSWER, 'music');
		expect(tuned).toContain('a=fmtp:63 111/111');
		expect(tuned).toContain('a=rtpmap:96 VP8/90000');
		expect(tuned.split('\r\n')).toHaveLength(ANSWER.split('\r\n').length);
	});

	it('何度かけても同じ結果になる', () => {
		const once = tuneOpusAnswer(ANSWER, 'music');
		expect(tuneOpusAnswer(once, 'music')).toBe(once);
	});

	it('設定行がなければ足す。Opus がなければ何もしない', () => {
		const bare = ANSWER.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
		expect(fmtp(tuneOpusAnswer(bare, 'music'))).toContain('stereo=1');

		const videoOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
		expect(tuneOpusAnswer(videoOnly, 'music')).toBe(videoOnly);
	});
});
