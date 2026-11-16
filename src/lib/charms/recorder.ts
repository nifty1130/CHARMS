/**
 * 録画
 *
 * - {@link startRecording}: 映像（MediaStream）をファイルに保存する
 * - {@link ProgramMixer}: モニターに映している映像を、切り替えをまたいで1本の映像にまとめる
 *
 * 録画はホストが「録画を許可」にしているときだけ、画面から使えるようにする。
 */

/** 保存先を選べるブラウザ（PC の Chrome / Edge）かどうか */
function canPickFile(): boolean {
	return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/** このブラウザで録画できる形式を選ぶ（再生しやすい MP4 を優先） */
export function pickRecordingFormat(): { mimeType: string; extension: string } | null {
	if (typeof MediaRecorder === 'undefined') return null;
	const candidates = [
		{ mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
		{ mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
		{ mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
		{ mimeType: 'video/webm', extension: 'webm' },
		{ mimeType: 'video/mp4', extension: 'mp4' }
	];
	return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

/** ファイル名に使えない文字を取り除く */
function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'CHARMPoint';
}

/** 録画ファイルの名前を作る（例: カメラ1_2026-11-16_14-30-05.mp4） */
export function recordingFileName(label: string, extension: string, now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
	return `${safeFileName(label)}_${date}_${time}.${extension}`;
}

export interface RecordingOptions {
	/** ファイル名の先頭に付ける名前（端末の名前など） */
	label: string;
	/** 録画したデータ量が増えたとき（バイト数） */
	onProgress?: (bytes: number) => void;
	/** 録画が（エラーなどで）勝手に止まったとき */
	onEnd?: (error?: Error) => void;
}

export interface Recording {
	/** 録画を止めて、ファイルを保存する */
	stop(): Promise<void>;
	/** 保存先をあらかじめ選んで、ディスクに直接書き込んでいるか（長時間の録画に向く） */
	readonly direct: boolean;
}

/**
 * 録画を始める
 *
 * 保存先を選べるブラウザでは、最初に保存先を選んでもらい、ディスクに直接書き込む（長時間でも安全）。
 * それ以外では、いったんメモリにためて、止めたときにダウンロードする。
 *
 * ボタンを押した直後（ユーザーの操作の中）で呼ぶこと。
 *
 * @returns 録画の操作。保存先の選択をキャンセルしたときは null
 * @throws このブラウザが録画に対応していない場合
 */
export async function startRecording(
	stream: MediaStream,
	options: RecordingOptions
): Promise<Recording | null> {
	const format = pickRecordingFormat();
	if (!format) {
		throw new Error('このブラウザは録画に対応していません');
	}
	const fileName = recordingFileName(options.label, format.extension);

	let writable: FileSystemWritableFileStream | null = null;
	if (canPickFile()) {
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName: fileName,
				types: [
					{
						description: '動画',
						accept: { [format.mimeType.split(';')[0]]: [`.${format.extension}`] } as Record<
							`${string}/${string}`,
							`.${string}`[]
						>
					}
				]
			});
			writable = await handle.createWritable();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			// 保存先を選べなかった場合は、メモリにためる方法に切り替える
			writable = null;
		}
	}

	const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
	const chunks: Blob[] = [];
	let bytes = 0;
	let writing: Promise<unknown> = Promise.resolve();
	let stopped = false;

	recorder.ondataavailable = (event) => {
		if (event.data.size === 0) return;
		bytes += event.data.size;
		options.onProgress?.(bytes);
		if (writable) {
			// 書き込みは順番を守って1つずつ行う
			const target = writable;
			writing = writing.then(() => target.write(event.data)).catch(() => {});
		} else {
			chunks.push(event.data);
		}
	};

	const finish = async () => {
		await writing;
		if (writable) {
			await writable.close().catch(() => {});
		} else if (chunks.length > 0) {
			download(new Blob(chunks, { type: format.mimeType.split(';')[0] }), fileName);
		}
	};

	const ended = new Promise<void>((resolve) => {
		recorder.onstop = () => {
			void finish().then(() => {
				resolve();
				if (!stopped) options.onEnd?.();
			});
		};
	});
	recorder.onerror = () => {
		if (!stopped) options.onEnd?.(new Error('録画中にエラーが起きました'));
	};

	// 1秒ごとにデータを受け取る（途中で止まっても、そこまでは残る）
	recorder.start(1000);

	return {
		direct: writable !== null,
		async stop() {
			stopped = true;
			if (recorder.state !== 'inactive') recorder.stop();
			await ended;
		}
	};
}

/** ブラウザのダウンロードとしてファイルを保存する */
function download(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 録画時間を「12:34」や「1:02:03」の形にする */
export function formatDuration(ms: number): string {
	const total = Math.floor(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** データ量を「12.3 MB」の形にする */
export function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * ProgramMixer — モニターに映している映像を、1本の映像にまとめる
 *
 * モニターでは切り替えのたびに映像の送り元が変わる。そのまま録画すると切り替えで録画が
 * 途切れてしまうので、「いま画面に出ている映像」をキャンバスに描き写し続け、それを録画する。
 * 音声も同じように、いま出ている映像の音だけをつなぎ替える。
 */
export class ProgramMixer {
	/** 録画に渡す、まとめた映像 */
	readonly stream: MediaStream;

	readonly #canvas: HTMLCanvasElement;
	readonly #context: CanvasRenderingContext2D;
	readonly #audio: AudioContext;
	readonly #destination: MediaStreamAudioDestinationNode;
	readonly #timer: ReturnType<typeof setInterval>;
	#video: HTMLVideoElement | null = null;
	#source: MediaStreamAudioSourceNode | null = null;
	#sourceStream: MediaStream | null = null;

	constructor(width = 1280, height = 720, frameRate = 30) {
		this.#canvas = document.createElement('canvas');
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#context = this.#canvas.getContext('2d')!;
		this.#audio = new AudioContext();
		this.#destination = this.#audio.createMediaStreamDestination();

		this.stream = this.#canvas.captureStream(frameRate);
		for (const track of this.#destination.stream.getAudioTracks()) this.stream.addTrack(track);

		this.#draw();
		this.#timer = setInterval(() => this.#draw(), 1000 / frameRate);
	}

	/** いま画面に出している映像を指定する（何も出していないときは null） */
	setProgram(video: HTMLVideoElement | null, stream: MediaStream | null): void {
		this.#video = video;
		if (stream === this.#sourceStream) return;

		this.#source?.disconnect();
		this.#source = null;
		this.#sourceStream = stream;
		if (stream && stream.getAudioTracks().length > 0) {
			this.#source = this.#audio.createMediaStreamSource(stream);
			this.#source.connect(this.#destination);
		}
	}

	destroy(): void {
		clearInterval(this.#timer);
		this.#source?.disconnect();
		for (const track of this.stream.getTracks()) track.stop();
		void this.#audio.close().catch(() => {});
	}

	/** 映像の縦横比を保ったまま、黒い余白を付けて描く */
	#draw(): void {
		const { width, height } = this.#canvas;
		const context = this.#context;
		context.fillStyle = '#000';
		context.fillRect(0, 0, width, height);

		const video = this.#video;
		if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
		const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
		const w = video.videoWidth * scale;
		const h = video.videoHeight * scale;
		context.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
	}
}
