<script lang="ts">
	import AppHeader from '../../components/AppHeader.svelte';
	import ConnectPanel from '../../components/ConnectPanel.svelte';
	import InvitePanel from '../../components/InvitePanel.svelte';
	import NetBadge from '../../components/NetBadge.svelte';
	import Switcher from '../../components/Switcher.svelte';
	import { HostSession } from '$lib/charms/host.svelte';
	import { loadIceServers } from '$lib/charms/ice';
	import { ROLE_DEFAULTS, type NodeInfo, type NodeRole } from '$lib/charms/protocol';
	import { confirmBeforeLeaving, keepScreenAwake } from '$lib/charms/wake-lock';
	import { roleOf } from '$lib/roles';
	import { onDestroy, onMount } from 'svelte';

	// 状況を端末に保存しておき、読み込み直しても続きから再開できるようにする
	const host = new HostSession({ persist: true });
	const role = roleOf('host');

	const nodes = $derived(host.snapshot.nodes);
	const groups = $derived(
		(['camera', 'admin', 'monitor', 'controller'] as NodeRole[]).map((id) => ({
			id,
			label: ROLE_DEFAULTS[id].label,
			nodes: nodes.filter((node) => node.role === id)
		}))
	);

	/** 端末を追加する画面を開いているか（最初は開いておく） */
	let adding = $state(true);
	let renamingId = $state<string | null>(null);
	let nameDraft = $state('');
	/** 配信元で映像の中継（TURN）が使えるか（設定の説明を変えるため） */
	let relayAvailable = $state(false);
	/** 直接つながらなかった映像接続を、名前で並べたもの */
	const relayPairs = $derived(
		host.relayNeeded.map(({ sourceId, sinkId }) => `${nameOf(sourceId)} → ${nameOf(sinkId)}`)
	);

	function nameOf(id: string): string {
		if (id === 'host') return 'ホスト';
		return nodes.find((node) => node.id === id)?.name ?? id;
	}

	/** 画面の下に少しの間だけ出すお知らせ */
	let toast = $state<string | null>(null);
	let seenEvents = 0;

	$effect(() => {
		if (adding) host.openInvite();
		else host.closeInvite();
	});

	// 端末がつながった・切れたときに、お知らせを出す
	$effect(() => {
		const events = host.events;
		if (events.length === seenEvents) return;
		seenEvents = events.length;
		toast = events[0].text;
		const timer = setTimeout(() => (toast = null), 4000);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		// インターネットにつながっていれば、合言葉でもつなげるようにする
		if (host.roomPreferred) host.openRoom();
		void loadIceServers().then(() => (relayAvailable = host.relayAvailable));

		const releaseWake = keepScreenAwake();
		// 端末がつながっている間は、うっかり閉じないよう確認を出す
		const releaseGuard = confirmBeforeLeaving(() => host.snapshot.nodes.length > 0);
		return () => {
			releaseWake();
			releaseGuard();
		};
	});

	onDestroy(() => host.destroy());

	function startRename(node: NodeInfo) {
		renamingId = node.id;
		nameDraft = node.name;
	}

	function submitRename(event: SubmitEvent) {
		event.preventDefault();
		if (renamingId && nameDraft.trim()) host.rename(renamingId, nameDraft);
		renamingId = null;
	}

	/** 本番中に誤って押しても切れないよう、確認してから切断する */
	function disconnect(node: NodeInfo) {
		if (confirm(`「${node.name}」を切断しますか？
もう一度つなぐには、合言葉の入力か QR コードの読み取りからやり直しになります。`)) {
			host.disconnect(node.id);
		}
	}

	function isSource(node: NodeInfo): boolean {
		return node.role === 'camera' || node.role === 'admin';
	}

	function statusOf(node: NodeInfo): string {
		if (isSource(node)) return node.live ? '映像を送れます' : '映像の準備中';
		if (node.role === 'monitor') {
			const route = host.snapshot.routes.find((r) => r.monitorId === node.id);
			const program = nodes.find((n) => n.id === route?.program);
			return program ? `「${program.name}」を表示中` : '何も映していません';
		}
		return '操作できます';
	}

	function formatTime(at: number): string {
		return new Date(at).toLocaleTimeString('ja-JP', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>ホスト — CHARM Point</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-10 md:py-8">
	<AppHeader {role} status="connected" statusText="{nodes.length}台とつながっています" />

	<p
		class="mt-4 border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100"
	>
		<strong class="font-semibold">このページは閉じないでください。</strong
		>閉じたり再読み込みしたりすると、全端末がつなぎ直しになります（モニターの映像はそのまま出続けます。合言葉が使えるときは、開き直すと端末が自動で戻ってきます）。
	</p>

	<div class="mt-6 space-y-6">
		<!-- 端末を追加 -->
		<section>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<h1 class="text-xl font-semibold tracking-tight">端末をつなぐ</h1>
				<button
					type="button"
					class="btn {adding ? '' : 'btn-primary'}"
					onclick={() => (adding = !adding)}
				>
					{adding ? '追加を終わる' : '＋ 端末を追加する'}
				</button>
			</div>
			{#if adding}
				<!-- QR コードでつなぐのが基本。合言葉は、口で伝えたり離れた端末を招いたりするときに使う -->
				<div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
					{#if host.invite}
						<div>
							<h2 class="mb-1 text-base font-semibold">
								QR コードでつなぐ<span class="hint ml-2 font-normal">インターネットは不要</span>
							</h2>
							<p class="hint mb-3">
								つなぎたい端末で役割を選ぶと、同じような画面が出ます。お互いの QR
								コードを、CHARM Point の画面で読み取り合ってください。1台つながると、続けて次の端末をつなげます。
							</p>
							<ConnectPanel pairing={host.invite} side="host" onRestart={() => host.resetInvite()} />
						</div>
					{/if}
					<div class="xl:pt-[3.25rem]">
						<InvitePanel {host} />
					</div>
				</div>
			{:else}
				<p class="hint">端末を増やすときは「端末を追加する」を押してください。</p>
			{/if}
		</section>

		{#if relayPairs.length > 0}
			<div class="flex flex-wrap items-center gap-3 border border-amber-500/50 bg-amber-500/10 px-4 py-3" role="alert">
				<p class="min-w-0 flex-1 text-base text-amber-100">
					<strong class="font-semibold">直接つながらない映像があります</strong>（{relayPairs.join('、')}）。端末同士の通信を止めているネットワークや、離れた場所の端末では、中継サーバーを通すとつながります。中継した通信量に応じて、配信元に費用がかかることがあります。
				</p>
				<button type="button" class="btn btn-primary" onclick={() => host.setAllowRelay(true)}>中継を使う</button>
				<button type="button" class="btn btn-quiet" onclick={() => host.dismissRelayNeeded()}>閉じる</button>
			</div>
		{/if}

		<!-- つながっている端末 -->
		<section class="panel">
			<div class="panel-head">
				<h2 class="panel-title">つながっている端末</h2>
				<span class="hint">{nodes.length}台</span>
			</div>
			{#if host.absent.length > 0}
				<div class="border-b border-zinc-800 bg-amber-500/5 p-3" aria-label="戻ってくるのを待っている端末">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="min-w-0 flex-1 text-sm text-amber-100">
							<strong class="font-semibold">
								{host.restored ? '前回の続きから再開しました。' : ''}接続が切れた端末が戻ってくるのを待っています（{host
									.absent.length}台）。
							</strong>
							戻ってきたら、同じ名前・同じ映像の割り当てに戻します。合言葉でつないだ端末は自動で戻ります。
						</p>
						<button type="button" class="btn btn-quiet text-xs" onclick={() => host.forget()}>
							待つのをやめる
						</button>
					</div>
					<ul class="mt-2 flex flex-wrap gap-2">
						{#each host.absent as node (node.id)}
							<li
								class="flex items-center gap-1 border border-zinc-700 bg-zinc-950 py-0.5 pr-0.5 pl-2 text-xs text-zinc-300"
							>
								{node.name}
								<button
									type="button"
									class="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-100"
									aria-label="{node.name} を待つのをやめる"
									onclick={() => host.forget(node.id)}
								>
									×
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if nodes.length === 0}
				<p class="hint p-6 text-center">まだどの端末もつながっていません。</p>
			{:else}
				<div class="grid grid-cols-1 gap-px bg-zinc-800 md:grid-cols-2 xl:grid-cols-4">
					{#each groups as group (group.id)}
						<div class="bg-zinc-900 p-3">
							<h3 class="flex items-baseline justify-between text-sm font-semibold text-zinc-300">
								{group.label}
								<span class="font-mono text-xs text-zinc-500">{group.nodes.length}台</span>
							</h3>
							<ul class="mt-2 space-y-2">
								{#each group.nodes as node (node.id)}
									<li class="border border-zinc-800 bg-zinc-950 p-2.5">
										{#if renamingId === node.id}
											<form class="flex gap-2" onsubmit={submitRename}>
												<!-- svelte-ignore a11y_autofocus -->
												<input
													class="field min-h-9 py-1 text-sm"
													bind:value={nameDraft}
													maxlength="24"
													aria-label="名前"
													autofocus
												/>
												<button type="submit" class="btn min-h-9 px-3 py-1">決定</button>
											</form>
										{:else}
											<div class="flex items-start justify-between gap-2">
												<div class="min-w-0">
													<div class="truncate text-sm font-semibold">{node.name}</div>
													<div
														class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400"
													>
														<span
															class="size-2 rounded-full {isSource(node) && !node.live
																? 'bg-amber-400'
																: 'bg-emerald-400'}"
														></span>
														<span>{statusOf(node)}</span>
														<NetBadge net={node.net} />
														{#if node.recording}
															<span class="font-medium text-red-500">● 録画中</span>
														{/if}
													</div>
												</div>
												<div class="flex shrink-0">
													<button
														type="button"
														class="btn btn-quiet text-xs"
														onclick={() => startRename(node)}
													>
														名前
													</button>
													<button
														type="button"
														class="btn btn-quiet text-xs hover:text-red-300"
														onclick={() => disconnect(node)}
													>
														切断
													</button>
												</div>
											</div>
										{/if}
									</li>
								{:else}
									<li class="text-xs text-zinc-600">なし</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- 切り替え -->
		<section>
			<h2 class="mb-1 text-xl font-semibold tracking-tight">映像を切り替える</h2>
			<p class="hint mb-3">
				ホストからも切り替えられます。専用の端末で操作したいときは、その端末で「スイッチャー」を選んでつないでください。
			</p>
			<Switcher api={host} />
		</section>

		<!-- 設定 -->
		<section class="panel">
			<div class="panel-head">
				<h2 class="panel-title">設定</h2>
			</div>
			<label class="flex cursor-pointer items-start gap-3 p-4">
				<input
					type="checkbox"
					class="mt-1 size-5 accent-red-500"
					checked={host.snapshot.settings.allowRecording}
					onchange={(event) => host.setAllowRecording(event.currentTarget.checked)}
				/>
				<span>
					<span class="text-base font-medium">録画を許可する</span>
					<span class="hint mt-0.5 block">
						オンにすると、カメラ・テロップ・モニターの画面に「録画を始める」ボタンが出ます。カメラでは撮ったままの映像を、モニターでは切り替え済みの映像を録画できます。録画が禁止されている催しでは、オフのままにしてください。
					</span>
				</span>
			</label>
			<label class="flex cursor-pointer items-start gap-3 border-t border-zinc-800 p-4">
				<input
					type="checkbox"
					class="mt-1 size-5 accent-red-500"
					checked={host.snapshot.settings.allowRelay}
					disabled={!relayAvailable && !host.snapshot.settings.allowRelay}
					onchange={(event) => host.setAllowRelay(event.currentTarget.checked)}
				/>
				<span>
					<span class="text-base font-medium">映像の中継サーバーを使う</span>
					<span class="hint mt-0.5 block">
						{#if relayAvailable || host.snapshot.settings.allowRelay}
							端末同士が直接つながらないとき（端末同士の通信を止めている Wi-Fi、スマホの回線と別のネットワーク など）に、インターネット上の中継サーバーを通して映像を届けます。中継した通信量に応じて配信元に費用がかかることがあるので、必要なときだけオンにしてください。同じ
							LAN の端末同士は、オンでも直接つながります。
						{:else}
							いまは使えません（インターネットにつながっていないか、配信元に中継サーバーが設定されていません）。
						{/if}
					</span>
				</span>
			</label>
		</section>

		<!-- 記録 -->
		<details class="panel">
			<summary class="cursor-pointer px-4 py-3 text-sm text-zinc-300 hover:text-zinc-100">
				接続の記録（{host.events.length}件）
			</summary>
			<ul
				class="max-h-60 overflow-y-auto border-t border-zinc-800 px-4 py-2 font-mono text-xs text-zinc-400"
			>
				{#each host.events as event (event.at + event.text)}
					<li class="py-0.5">
						<span class="text-zinc-600">{formatTime(event.at)}</span>
						{event.text}
					</li>
				{:else}
					<li class="py-0.5 text-zinc-600">まだ記録はありません</li>
				{/each}
			</ul>
		</details>
	</div>
</div>

{#if toast}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
		role="status"
		aria-live="polite"
	>
		<div
			class="border border-zinc-600 bg-zinc-100 px-5 py-3 text-base font-medium text-zinc-950 shadow-lg"
		>
			{toast}
		</div>
	</div>
{/if}
