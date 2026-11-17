/**
 * カメラのズームとライト
 *
 * 対応しているのは一部の端末だけ（Android と iPhone の実機で動作を確認。PC のカメラの多くは非対応）。
 * 対応していない端末では null を返すので、画面では操作を出さない。
 */

import type { ZoomInfo } from './protocol';

/** ブラウザの型定義にまだ入っていない項目 */
interface ExtraCapabilities {
	zoom?: { min?: number; max?: number; step?: number };
	torch?: boolean;
}
interface ExtraSettings {
	zoom?: number;
	torch?: boolean;
}

function capabilities(track: MediaStreamTrack): ExtraCapabilities {
	try {
		return (track.getCapabilities?.() ?? {}) as ExtraCapabilities;
	} catch {
		return {};
	}
}

function settings(track: MediaStreamTrack): ExtraSettings {
	try {
		return track.getSettings() as ExtraSettings;
	} catch {
		return {};
	}
}

/**
 * ズームできる範囲と、いまの値を読む
 *
 * @returns ズームできないカメラでは null
 */
export function readZoom(track: MediaStreamTrack | null | undefined): ZoomInfo | null {
	if (!track) return null;
	const range = capabilities(track).zoom;
	if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return null;
	if (!(range.max > range.min)) return null;

	const step = typeof range.step === 'number' && range.step > 0 ? range.step : (range.max - range.min) / 100;
	const value = settings(track).zoom;
	return {
		min: range.min,
		max: range.max,
		step,
		value: typeof value === 'number' ? value : range.min
	};
}

/**
 * ライトが点いているかを読む
 *
 * @returns ライトのないカメラでは null
 */
export function readTorch(track: MediaStreamTrack | null | undefined): boolean | null {
	if (!track) return null;
	if (capabilities(track).torch !== true) return null;
	return settings(track).torch === true;
}

/** 値を、範囲の中に収める */
export function clampZoom(zoom: Pick<ZoomInfo, 'min' | 'max'>, value: number): number {
	if (!Number.isFinite(value)) return zoom.min;
	return Math.min(zoom.max, Math.max(zoom.min, value));
}

/**
 * ズームを変える
 *
 * @returns 変えたあとの状態。ズームできないカメラでは null
 */
export async function setZoom(track: MediaStreamTrack, value: number): Promise<ZoomInfo | null> {
	const zoom = readZoom(track);
	if (!zoom) return null;
	const next = clampZoom(zoom, value);
	try {
		await track.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] });
	} catch {
		// 変えられなかったときは、いまの状態をそのまま返す
	}
	return readZoom(track);
}

/**
 * ライトを点ける・消す
 *
 * @returns 変えたあとの状態。ライトのないカメラでは null
 */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean | null> {
	if (readTorch(track) === null) return null;
	try {
		await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
	} catch {
		// 上と同じ
	}
	return readTorch(track);
}
