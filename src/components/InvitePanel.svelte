<script lang="ts">
	import type { HostSession } from '$lib/charms/host.svelte';
	import { formatRoomCode, inviteUrl } from '$lib/charms/room';

	/**
	 * ホストの画面に出す、合言葉・招待リンクの案内
	 *
	 * インターネットにつながっているときだけ使える。つなぎたい端末は、6桁の合言葉を入力するか、
	 * 招待リンクを開くだけでつながる。口で伝えたり、離れた場所の端末を招いたりするときに使う。
	 * （会場の中の端末は、QR コードの読み取り合いでつなぐのが基本。画面に QR コードを2種類出すと
	 * 迷うので、招待リンクの QR コードは出さない）
	 */
	interface Props {
		host: HostSession;
	}

	let { host }: Props = $props();

	let copied = $state<string | null>(null);

	const room = $derived(host.room);
	const link = $derived(room ? inviteUrl(room.code) : '');
	/** OBS などに取り込むためのリンク（操作パネルなし・音あり・自動でつながるモニター） */
	const outputLink = $derived(
		room ? inviteUrl(room.code, '/monitor/', { clean: '1', sound: '1', name: '配信用の出力' }) : ''
	);
	/** 画面に出す、短い形の URL（https:// を省く） */
	const siteLabel = $derived(link ? new URL(link).host : '');

	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			setTimeout(() => {
				if (copied === what) copied = null;
			}, 2000);
		} catch {
			// コピーできない環境では、表示されている文字を手で選んでもらう
		}
	}

	function renew() {
		if (confirm('合言葉を作り直しますか？\nいまの合言葉とリンクは使えなくなります（すでにつながっている端末は、そのままです）。')) {
			host.renewRoom();
		}
	}
</script>

<section class="panel" aria-label="合言葉でつなぐ">
	<div class="panel-head">
		<h3 class="panel-title">合言葉でつなぐ</h3>
		<span class="hint">インターネットが必要</span>
	</div>

	{#if !room}
		<div class="flex flex-wrap items-center gap-3 p-4">
			<p class="hint min-w-0 flex-1">合言葉での受け付けは止めています。</p>
			<button type="button" class="btn" onclick={() => host.openRoom()}>受け付けを始める</button>
		</div>
	{:else if room.status === 'open'}
		<div class="p-4 sm:p-5">
			<p class="text-sm text-zinc-400">6桁の合言葉</p>
			<p
				class="mt-1 font-mono text-5xl leading-none font-semibold tracking-[0.12em] text-zinc-50"
				data-testid="room-code"
			>
				{formatRoomCode(room.code)}
			</p>
			<ol class="mt-4 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-zinc-200">
				<li>
					つなぎたい端末で <strong class="font-semibold text-zinc-50">{siteLabel}</strong> を開く
				</li>
				<li>役割（カメラ・モニターなど）を選ぶ</li>
				<li>この合言葉を入力する</li>
			</ol>
			<p class="hint mt-3">
				口で伝えるときに便利です。離れた場所の端末には、招待リンクを送ってください（開くだけでつながります）。
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<button type="button" class="btn" onclick={() => copy(link, 'link')}>
					{copied === 'link' ? 'コピーしました' : '招待リンクをコピー'}
				</button>
				<button type="button" class="btn btn-quiet" onclick={() => host.closeRoom()}>
					受け付けを止める
				</button>
			</div>
		</div>

		<details class="border-t border-zinc-800">
			<summary class="cursor-pointer px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100">
				OBS などの配信ソフトに映像を取り込む
			</summary>
			<div class="space-y-2 px-4 pb-4">
				<p class="hint">
					下のリンクを OBS の「ブラウザ」ソースの URL に貼り付けると、モニターとして自動でつながり、操作パネルのない映像だけが出ます。つながったら、スイッチャーでそのモニター（「配信用の出力」）に映す映像を選んでください。
				</p>
				<div class="flex flex-wrap gap-2">
					<input
						class="field min-w-0 flex-1 font-mono text-xs"
						readonly
						value={outputLink}
						aria-label="配信ソフト用のリンク"
						onfocus={(event) => event.currentTarget.select()}
					/>
					<button type="button" class="btn" onclick={() => copy(outputLink, 'output')}>
						{copied === 'output' ? 'コピーしました' : 'コピー'}
					</button>
				</div>
			</div>
		</details>

		<details class="border-t border-zinc-800">
			<summary class="cursor-pointer px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100">
				合言葉を知らない人に使われたくないとき
			</summary>
			<div class="space-y-2 px-4 pb-4">
				<p class="hint">
					合言葉を知っている人は、だれでも端末をつなげます。つながった端末は下の「つながっている端末」に出るので、心当たりのない端末は「切断」してください。全員つなぎ終わったら「受け付けを止める」を押しておくと安心です。
				</p>
				<button type="button" class="btn" onclick={renew}>合言葉を作り直す</button>
			</div>
		</details>
	{:else}
		<div class="flex flex-wrap items-center gap-3 p-4" role="status">
			<span
				class="size-2.5 shrink-0 rounded-full {room.status === 'connecting'
					? 'animate-pulse bg-amber-400'
					: 'bg-zinc-500'}"
			></span>
			<p class="min-w-0 flex-1 text-base text-zinc-200">
				{#if room.status === 'connecting'}
					合言葉を準備しています…
				{:else if room.status === 'refused' && room.reason === 'replaced'}
					別の画面で同じホストが開かれたため、この画面では合言葉を使えません。
				{:else if room.status === 'refused'}
					合言葉を使えませんでした。
				{:else}
					インターネットにつながっていないため、合言葉は使えません。QR
					コードでつないでください（つながり次第、自動で使えるようになります）。
				{/if}
			</p>
			{#if room.status === 'refused'}
				<button type="button" class="btn" onclick={() => host.renewRoom()}>やり直す</button>
			{/if}
		</div>
	{/if}
</section>
