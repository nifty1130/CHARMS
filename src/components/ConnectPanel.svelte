<script lang="ts">
	import type { LocalHostFinder } from '$lib/charms/local-pairing.svelte';
	import type { Pairing } from '$lib/charms/pairing.svelte';
	import QrCode from './QrCode.svelte';
	import QrScanner from './QrScanner.svelte';

	interface Props {
		/** つなぐための手続き */
		pairing: Pairing;
		/** この端末がホストか、ホストにつなぐ端末か */
		side: 'host' | 'node';
		/** 同じ端末で開いているホストを探す仕組み（端末側のみ） */
		finder?: LocalHostFinder | null;
		/** 最初からやり直すとき */
		onRestart: () => void;
	}

	let { pairing, side, finder = null, onRestart }: Props = $props();

	/** カメラの準備状況（許可を待っている / 使える / 使えない） */
	let camera = $state<'waiting' | 'ready' | 'unavailable'>('waiting');
	/** 「カメラが使えないとき」の欄を開いているか */
	let manualOpen = $state(false);
	let manualText = $state('');
	let copied = $state(false);
	let connectingLocal = $state(false);
	let localFailed = $state(false);

	const partner = $derived(side === 'host' ? '相手の端末' : 'ホスト');

	// カメラの許可をもらってから接続情報を集める。
	// 許可がある状態で集めると、QR に実際の IP アドレスが入り、つながりやすくなる。
	$effect(() => {
		if (pairing.state === 'idle' && camera !== 'waiting') void pairing.start();
	});

	// 許可の確認に答えないまま止まっている場合でも、先へ進めるようにする
	$effect(() => {
		if (camera !== 'waiting') return;
		const timer = setTimeout(() => {
			if (camera === 'waiting') camera = 'unavailable';
		}, 8000);
		return () => clearTimeout(timer);
	});

	/**
	 * 読み取り済みの QR と、それを受け付けた手続きの対応
	 *
	 * ホストは1台つながるたびに次の受け付けを始めるが、カメラにはまだ前の端末の QR が
	 * 映っている。同じ QR を次の受け付けで使ってしまわないよう、覚えておいて無視する。
	 */
	const acceptedBy = new Map<string, Pairing>();

	async function accept(text: string): Promise<boolean> {
		const owner = acceptedBy.get(text);
		if (owner && owner !== pairing) return false;
		const target = pairing;
		const ok = await target.accept(text);
		if (ok) acceptedBy.set(text, target);
		return ok;
	}

	// カメラが使えないと分かったら、文字で受け渡す欄を自動で開く
	$effect(() => {
		if (camera === 'unavailable') manualOpen = true;
	});

	function onScan(text: string) {
		void accept(text);
	}

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(pairing.qrText);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// コピーできない環境では、表示されている文字を手で選んでもらう
		}
	}

	async function submitManual() {
		const text = manualText.trim();
		if (!text) return;
		if (await accept(text)) manualText = '';
	}

	async function connectLocal() {
		if (!finder) return;
		connectingLocal = true;
		localFailed = false;
		// 接続情報の準備が終わっていなければ、終わるまで待つ
		await pairing.start();
		localFailed = !(await finder.connect(pairing));
		connectingLocal = false;
	}

	const status = $derived.by(() => {
		if (pairing.error) return { tone: 'error', text: pairing.error } as const;
		switch (pairing.state) {
			case 'idle':
			case 'gathering':
				return { tone: 'busy', text: '準備しています…' } as const;
			case 'ready':
				return { tone: 'wait', text: `${partner}の QR コードを待っています` } as const;
			case 'connecting':
				return {
					tone: 'busy',
					text: `${partner}の QR コードを読み取りました。${partner}にも、この画面の QR コードを読み取ってもらってください。`
				} as const;
			case 'connected':
				return { tone: 'ok', text: 'つながりました' } as const;
			default:
				return { tone: 'error', text: 'つながりませんでした' } as const;
		}
	});
</script>

<section class="panel" aria-label="接続">
	{#if side === 'node' && finder?.available}
		<div class="border-b border-zinc-800 bg-zinc-950/40 p-4">
			<p class="text-base font-medium text-zinc-100">この端末でホストが開かれています</p>
			<p class="hint mt-1">同じ端末なので、QR コードを使わずにつなげます。</p>
			<button
				type="button"
				class="btn btn-primary mt-3 w-full sm:w-auto"
				onclick={connectLocal}
				disabled={connectingLocal || pairing.state === 'connecting'}
			>
				{connectingLocal ? 'つないでいます…' : 'この端末のホストにつなぐ'}
			</button>
			{#if localFailed}
				<p class="mt-2 text-sm text-amber-300">
					つなげませんでした。ホストのタブが開いているか確認してください。
				</p>
			{/if}
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-px bg-zinc-800 md:grid-cols-2">
		<!-- 自分の QR -->
		<div class="flex flex-col bg-zinc-900 {side === 'node' ? 'md:order-2' : ''}">
			<div class="flex items-baseline gap-3 border-b border-zinc-800 px-4 py-3">
				<span class="font-mono text-2xl leading-none font-light text-zinc-500">
					{side === 'host' ? '1' : '2'}
				</span>
				<h3 class="text-base font-semibold">
					{side === 'host'
						? 'この QR コードを、つなぎたい端末で読み取る'
						: 'この QR コードを、ホストのカメラに見せる'}
				</h3>
			</div>
			<div class="flex flex-1 items-center justify-center p-4 sm:p-6">
				<div class="w-full max-w-80">
					{#if pairing.qrText}
						<QrCode data={pairing.qrText} />
					{:else}
						<div
							class="flex aspect-square w-full items-center justify-center border border-dashed border-zinc-700 p-6 text-center"
						>
							<p class="hint">
								{camera === 'waiting' ? 'カメラの許可を待っています…' : 'QR コードを作っています…'}
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- 相手の QR を読み取る -->
		<div class="flex flex-col bg-zinc-900 {side === 'node' ? 'md:order-1' : ''}">
			<div class="flex items-baseline gap-3 border-b border-zinc-800 px-4 py-3">
				<span class="font-mono text-2xl leading-none font-light text-zinc-500">
					{side === 'host' ? '2' : '1'}
				</span>
				<h3 class="text-base font-semibold">
					{side === 'host'
						? '相手の画面の QR コードを、このカメラで読み取る'
						: 'ホストの画面の QR コードを、このカメラで読み取る'}
				</h3>
			</div>
			<div class="flex flex-1 items-center justify-center p-4 sm:p-6">
				<div class="relative w-full max-w-80">
					<QrScanner
						{onScan}
						onReady={(available) => (camera = available ? 'ready' : 'unavailable')}
						class="aspect-square w-full border border-zinc-800"
					/>
					{#if pairing.scanned}
						<div
							class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-emerald-950/90 p-4 text-center"
						>
							<span class="text-3xl leading-none text-emerald-300" aria-hidden="true">✓</span>
							<span class="text-base font-medium text-emerald-100">読み取りました</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- いまの状況 -->
	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800 px-4 py-3"
		role="status"
		aria-live="polite"
	>
		<span
			class="size-2.5 shrink-0 rounded-full {status.tone === 'ok'
				? 'bg-emerald-400'
				: status.tone === 'error'
					? 'bg-red-500'
					: status.tone === 'busy'
						? 'animate-pulse bg-amber-400'
						: 'bg-zinc-500'}"
		></span>
		<p class="min-w-0 flex-1 text-base {status.tone === 'error' ? 'text-red-300' : 'text-zinc-100'}">
			{status.text}
		</p>
		{#if pairing.code && pairing.state !== 'failed'}
			<p class="text-sm text-zinc-400">
				確認コード
				<span class="ml-1 font-mono text-lg tracking-[0.2em] text-zinc-100">{pairing.code}</span>
				<span class="ml-1">（{partner}の画面と同じ数字なら OK）</span>
			</p>
		{/if}
		{#if pairing.error || pairing.state === 'failed' || pairing.state === 'connecting'}
			<button type="button" class="btn" onclick={onRestart}>最初からやり直す</button>
		{/if}
	</div>

	{#if pairing.notice && !pairing.error}
		<p class="border-t border-zinc-800 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="alert">
			{pairing.notice}
		</p>
	{/if}

	<!-- カメラがない端末のための方法 -->
	<details class="border-t border-zinc-800" bind:open={manualOpen}>
		<summary class="cursor-pointer px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100">
			カメラが使えないとき（コードを文字で受け渡す）
		</summary>
		<div class="grid grid-cols-1 gap-4 px-4 pb-4 md:grid-cols-2">
			<div>
				<label class="text-sm font-medium text-zinc-200" for="own-code">
					この端末のコード（{partner}に送る）
				</label>
				<textarea
					id="own-code"
					class="field mt-1 font-mono text-xs break-all"
					rows="4"
					readonly
					value={pairing.qrText}
					onfocus={(event) => event.currentTarget.select()}
				></textarea>
				<button type="button" class="btn mt-2" onclick={copyCode} disabled={!pairing.qrText}>
					{copied ? 'コピーしました' : 'コードをコピー'}
				</button>
			</div>
			<div>
				<label class="text-sm font-medium text-zinc-200" for="partner-code">
					{partner}のコード（ここに貼り付ける）
				</label>
				<textarea
					id="partner-code"
					class="field mt-1 font-mono text-xs break-all"
					rows="4"
					bind:value={manualText}
					placeholder="{partner}の画面でコピーしたコードを貼り付け"
				></textarea>
				<button
					type="button"
					class="btn btn-primary mt-2"
					onclick={submitManual}
					disabled={!manualText.trim() || !pairing.qrText}
				>
					このコードでつなぐ
				</button>
			</div>
		</div>
	</details>
</section>
