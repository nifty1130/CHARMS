/**
 * 映像接続（MediaLinks）のテスト（実際のブラウザで動かす）
 *
 * 送る側と受ける側を1つのページの中に作り、本物の WebRTC でつないで、
 * 音声の送り方（会話向け / 音楽向け）が接続の条件に反映されることを確かめる。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MediaLinks } from './media-links';

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** 送る側（カメラ）と受ける側（モニター）を作り、打ち合わせを直接受け渡すようにつなぐ */
function createPair() {
	const received: Record<string, MediaStream> = {};
	const sender: MediaLinks = new MediaLinks({
		sendSignal: (_to, description) => void receiver.handleSignal('camera', description)
	});
	const receiver: MediaLinks = new MediaLinks({
		sendSignal: (_to, description) => void sender.handleSignal('monitor', description),
		onStreams: (streams) => {
			for (const key of Object.keys(received)) delete received[key];
			Object.assign(received, streams);
		}
	});
	cleanups.push(() => {
		sender.closeAll();
		receiver.closeAll();
	});
	return { sender, receiver, received };
}

async function camera(): Promise<MediaStream> {
	const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
	cleanups.push(() => stream.getTracks().forEach((track) => track.stop()));
	return stream;
}

/** 接続の、音声（Opus）の条件を読む */
function opusFmtp(description: RTCSessionDescription | null): string {
	const sdp = description?.sdp ?? '';
	const payload = /^a=rtpmap:(\d+) opus\/48000/im.exec(sdp)?.[1];
	return new RegExp(`^a=fmtp:${payload} (.*)$`, 'm').exec(sdp)?.[1] ?? '';
}

function outgoing(links: MediaLinks): RTCPeerConnection {
	const link = links.connections().find((connection) => connection.direction === 'out');
	expect(link).toBeDefined();
	return link!.pc;
}

async function connected(pc: RTCPeerConnection): Promise<void> {
	await expect.poll(() => pc.connectionState, { timeout: 15_000 }).toBe('connected');
}

describe('音声の送り方', () => {
	it('会話向け（既定）では、モノラル・控えめなビットレートで送る', async () => {
		const { sender, received } = createPair();
		await sender.setLocalStream(await camera());
		await sender.offerTo('monitor', 'program');

		const pc = outgoing(sender);
		await connected(pc);
		await expect.poll(() => received.camera?.getAudioTracks().length).toBe(1);

		expect(opusFmtp(pc.remoteDescription)).not.toContain('stereo');
		const audio = pc.getSenders().find((s) => s.track?.kind === 'audio');
		expect(audio?.getParameters().encodings[0].maxBitrate).toBe(64_000);
	});

	it('音楽向けでは、ステレオ・高ビットレートで送る', async () => {
		const { sender, receiver, received } = createPair();
		await sender.setAudioMode('music');
		await sender.setLocalStream(await camera());
		await sender.offerTo('monitor', 'program');

		const pc = outgoing(sender);
		await connected(pc);
		await expect.poll(() => received.camera?.getAudioTracks().length).toBe(1);

		const fmtp = opusFmtp(pc.remoteDescription);
		expect(fmtp).toContain('stereo=1');
		expect(fmtp).toContain('maxaveragebitrate=256000');
		const audio = pc.getSenders().find((s) => s.track?.kind === 'audio');
		expect(audio?.getParameters().encodings[0].maxBitrate).toBe(256_000);

		// 受ける側は「ステレオで受け取れます」と答えている
		const incoming = receiver.connections().find((connection) => connection.direction === 'in');
		expect(opusFmtp(incoming!.pc.localDescription)).toContain('stereo=1');
	});

	it('途中で送り方を変えると、接続を張り直して新しい条件にする', async () => {
		const { sender, received } = createPair();
		await sender.setLocalStream(await camera());
		await sender.offerTo('monitor', 'program');
		const before = outgoing(sender);
		await connected(before);

		await sender.setAudioMode('music');
		const after = outgoing(sender);
		expect(after).not.toBe(before);
		await connected(after);
		expect(opusFmtp(after.remoteDescription)).toContain('stereo=1');
		await expect.poll(() => received.camera?.getVideoTracks().length).toBe(1);

		// 同じ送り方をもう一度指定しても、張り直さない
		await sender.setAudioMode('music');
		expect(outgoing(sender)).toBe(after);
	});

	it('確認用の小さな映像（音声なし）は、送り方を変えても張り直さない', async () => {
		const { sender } = createPair();
		await sender.setLocalStream(await camera());
		await sender.offerTo('monitor', 'thumbnail');
		const before = outgoing(sender);
		await connected(before);

		await sender.setAudioMode('music');
		expect(outgoing(sender)).toBe(before);
	});
});
