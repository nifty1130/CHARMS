<script lang="ts">
	import { drawTelop, type TelopScene } from '$lib/charms/telop';
	import { onMount } from 'svelte';

	/**
	 * テロップの場面を描く（モニター・テロップ端末の確認用）
	 *
	 * 置かれた場所の大きさに合わせて、16:9 の画面として描く（はみ出さず、余白は透明）。
	 * 画面の解像度に合わせて描き直すので、大きな画面でも文字がにじまない。
	 */
	interface Props {
		scene: TelopScene | null;
		/** 背景を塗らずに透かす（カメラ映像に重ねるとき） */
		transparent?: boolean;
		class?: string;
		/** 描いているキャンバス（録画で、同じ絵を使うため） */
		canvas?: HTMLCanvasElement;
	}

	let { scene, transparent = false, class: className = '', canvas = $bindable() }: Props = $props();

	/** いまの表示の大きさ（実際の画素数） */
	let size = $state({ width: 1280, height: 720 });

	onMount(() => {
		if (!canvas) return;
		const target = canvas;
		const observer = new ResizeObserver(() => {
			const box = target.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) return;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			// 置かれた場所に収まる 16:9 の大きさ（4K を上限にする）
			const width = Math.min(3840, Math.round(Math.min(box.width, (box.height * 16) / 9) * ratio));
			const height = Math.round((width * 9) / 16);
			if (width !== size.width || height !== size.height) size = { width, height };
		});
		observer.observe(target);
		return () => observer.disconnect();
	});

	$effect(() => {
		const { width, height } = size;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		drawTelop(context, scene, { width, height, transparent });
	});
</script>

<canvas bind:this={canvas} class="object-contain {className}" data-telop={transparent ? 'overlay' : 'full'}></canvas>
