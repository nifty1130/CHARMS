<script lang="ts">
	import QRCode from 'qrcode';

	interface Props {
		data: string;
		size?: number;
		class?: string;
	}

	let { data, size = 320, class: className = '' }: Props = $props();
	let canvas: HTMLCanvasElement | undefined = $state();

	$effect(() => {
		if (!canvas || !data) return;
		QRCode.toCanvas(canvas, data, {
			width: size,
			margin: 1,
			color: { dark: '#18181b', light: '#ffffff' }
		}).catch(() => {});
	});
</script>

<canvas bind:this={canvas} class={className}></canvas>
