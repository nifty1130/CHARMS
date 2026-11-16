<script lang="ts">
	import QRCode from 'qrcode';
	import { QR_ERROR_CORRECTION_LEVEL } from '$lib/rtc';

	interface Props {
		/** QR に入れる文字列 */
		data: string;
		/** 描画する大きさ（ピクセル）。表示は親の幅に合わせて縮む */
		size?: number;
		class?: string;
	}

	let { data, size = 640, class: className = '' }: Props = $props();
	let canvas: HTMLCanvasElement | undefined = $state();

	$effect(() => {
		if (!canvas || !data) return;
		const target = canvas;
		QRCode.toCanvas(target, data, {
			width: size,
			margin: 2,
			errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
			color: { dark: '#000000', light: '#ffffff' }
		})
			.then(() => {
				// ライブラリが表示サイズを固定値で書き込むので消す（親の幅に合わせて縮むようにする）
				target.style.removeProperty('width');
				target.style.removeProperty('height');
			})
			.catch(() => {});
	});
</script>

<!-- QR は白地に黒が最も読み取りやすいので、周りの配色に関係なく白い枠で囲む -->
<canvas
	bind:this={canvas}
	class="block aspect-square h-auto w-full bg-white {className}"
	aria-label="この端末の QR コード"
></canvas>
