<script lang="ts">
	interface Props {
		/** 表示する映像（null のときは黒） */
		stream: MediaStream | null | undefined;
		/** 音を出さない（既定: 出さない） */
		muted?: boolean;
		/** 枠への収め方（contain: 全体を表示 / cover: 枠を埋める） */
		fit?: 'contain' | 'cover';
		/** 左右を反転する（自分撮りカメラの確認用） */
		mirror?: boolean;
		/** video 要素を外から使いたいとき */
		element?: HTMLVideoElement;
		/** 絵が出始めたとき */
		onPlaying?: () => void;
		class?: string;
	}

	let {
		stream,
		muted = true,
		fit = 'contain',
		mirror = false,
		element = $bindable(),
		onPlaying,
		class: className = ''
	}: Props = $props();

	$effect(() => {
		if (!element) return;
		const next = stream ?? null;
		if (element.srcObject !== next) element.srcObject = next;
		// 自動再生が止められた場合に備えて、明示的に再生を始める
		if (next) element.play().catch(() => {});
	});

	// muted は属性ではなくプロパティで切り替える（あとから音を出せるようにするため）
	$effect(() => {
		if (element) element.muted = muted;
	});
</script>

<video
	bind:this={element}
	autoplay
	playsinline
	muted
	onplaying={onPlaying}
	class="block bg-black {fit === 'cover' ? 'object-cover' : 'object-contain'} {className}"
	style:transform={mirror ? 'scaleX(-1)' : undefined}
></video>
