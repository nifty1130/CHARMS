/**
 * 映像の画質の設定
 *
 * 映像は送り先の数だけ別々に圧縮されるため、送り先が増えるほどカメラ端末の負荷が上がる。
 * 低スペック端末（Surface SE など）でも動くよう、画質ごとに「無理なく送れる台数」の目安を持つ。
 */

import type { QualityId } from './protocol';

export interface QualityPreset {
	id: QualityId;
	/** 画面に表示する名前 */
	label: string;
	/** 解像度とフレームレートの説明 */
	detail: string;
	width: number;
	height: number;
	frameRate: number;
	/** 本番用の映像1本あたりの上限ビットレート（bps） */
	maxBitrate: number;
	/** 低スペック端末で同時に映せるモニター台数の目安 */
	recommendedMonitors: number;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
	low: {
		id: 'low',
		label: '軽い',
		detail: '480p・15コマ/秒',
		width: 854,
		height: 480,
		frameRate: 15,
		maxBitrate: 500_000,
		recommendedMonitors: 8
	},
	medium: {
		id: 'medium',
		label: '標準',
		detail: '720p・30コマ/秒',
		width: 1280,
		height: 720,
		frameRate: 30,
		maxBitrate: 2_500_000,
		recommendedMonitors: 3
	},
	high: {
		id: 'high',
		label: '高画質',
		detail: '1080p・30コマ/秒',
		width: 1920,
		height: 1080,
		frameRate: 30,
		maxBitrate: 5_000_000,
		recommendedMonitors: 1
	}
};

export const QUALITY_ORDER: QualityId[] = ['low', 'medium', 'high'];

/** 画質の初期値。台数が多い運用を想定して、標準にしておく */
export const DEFAULT_QUALITY: QualityId = 'medium';

/**
 * 確認用の小さな映像の設定
 *
 * ホストやスイッチャーに並べるだけなので、極力軽くする。
 * これにより、スイッチャーを何台つないでもカメラ端末の負荷がほとんど増えない。
 */
export const THUMBNAIL = {
	height: 180,
	frameRate: 10,
	maxBitrate: 150_000
} as const;

/** カメラに渡す撮影条件を作る */
export function videoConstraints(quality: QualityId, deviceId?: string): MediaTrackConstraints {
	const preset = QUALITY_PRESETS[quality];
	return {
		...(deviceId ? { deviceId: { exact: deviceId } } : {}),
		width: { ideal: preset.width },
		height: { ideal: preset.height },
		frameRate: { ideal: preset.frameRate }
	};
}
