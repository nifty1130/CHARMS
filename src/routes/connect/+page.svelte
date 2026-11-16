<script lang="ts">
	import { page } from '$app/state';
	import QrCode from '../../components/QrCode.svelte';
	import QrScanner from '../../components/QrScanner.svelte';
	import RoleBadge from '../../components/RoleBadge.svelte';
	import { roles } from '$lib/roles';

	let roleParam = $derived(page.url.searchParams.get('role'));
	let role = $derived(roles.find((r) => r.id === roleParam));

	// TODO: WebRTC のシグナリングペイロードに差し替え
	let qrPayload = $derived(
		role ? JSON.stringify({ role: role.id, ts: Date.now() }) : ''
	);

	function handleScan(data: string) {
		// TODO: scanned data をパースしてピアリングを確立し、
		//       セッションを localStorage に保存して /{role} に遷移する
		console.log('scanned:', data);
	}
</script>

<svelte:head>
	<title>CHARMsExEx — 新規接続</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
	<div class="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
		<!-- system bar -->
		<header class="flex items-center justify-between border-b border-zinc-800 pb-4">
			<div class="flex items-center gap-3">
				<span class="relative flex size-2">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"
					></span>
					<span class="relative inline-flex size-2 rounded-full bg-red-500"></span>
				</span>
				<span class="font-mono text-xs uppercase tracking-[0.22em] text-zinc-200">
					CHARMsExEx
				</span>
			</div>
			<a
				href="/"
				class="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-200"
			>
				← 役割選択へ戻る
			</a>
		</header>

		{#if !role}
			<!-- invalid role -->
			<section class="mt-12 border border-red-500/60 bg-red-500/10 p-6">
				<div class="font-mono text-[10px] uppercase tracking-[0.2em] text-red-300">
					error <span class="text-red-500/50">/</span> invalid role
				</div>
				<p class="mt-3 text-sm text-zinc-100">
					不正な role パラメータです:
					<span class="font-mono text-red-300">{roleParam ?? '(指定なし)'}</span>
				</p>
				<p class="mt-2 text-xs text-zinc-400">
					有効な役割は <span class="font-mono">host</span> /
					<span class="font-mono">camera</span> /
					<span class="font-mono">text</span> /
					<span class="font-mono">monitor</span> /
					<span class="font-mono">controller</span> です。
				</p>
				<a
					href="/"
					class="mt-5 inline-block font-mono text-xs uppercase tracking-[0.2em] text-zinc-300 underline underline-offset-4 hover:text-zinc-100"
				>
					役割選択へ戻る →
				</a>
			</section>
		{:else}
			<!-- title -->
			<section class="py-8 md:py-10">
				<h1 class="text-2xl font-medium tracking-tight">新規接続</h1>
			</section>

			<!-- role banner -->
			<RoleBadge {role} />

			<!-- QR + Scanner -->
			<section
				class="mt-6 grid grid-cols-1 gap-px border border-zinc-800 bg-zinc-800 lg:grid-cols-2"
				aria-label="経路交換"
			>
				<!-- YOUR CODE -->
				<div class="flex flex-col bg-zinc-900">
					<div
						class="flex items-center justify-between border-b border-zinc-800 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500"
					>
						<span>your code</span>
						<span class="text-zinc-600">自分のコード</span>
					</div>

					<div class="flex flex-1 items-center justify-center p-8">
						<div class="bg-white p-3">
							<QrCode data={qrPayload} size={320} />
						</div>
					</div>

					<div
						class="border-t border-zinc-800 px-4 py-3 text-xs leading-relaxed text-zinc-400"
					>
						このコードを相手の端末でスキャンしてもらいます。
					</div>
				</div>

				<!-- SCAN PARTNER -->
				<div class="flex flex-col bg-zinc-900">
					<div
						class="flex items-center justify-between border-b border-zinc-800 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500"
					>
						<span>scan partner</span>
						<span class="text-zinc-600">相手のコードを読み取る</span>
					</div>

					<div class="flex flex-1 items-center justify-center p-8">
						<QrScanner
							onScan={handleScan}
							class="aspect-square w-full max-w-85 border border-zinc-800"
						/>
					</div>

					<div
						class="border-t border-zinc-800 px-4 py-3 text-xs leading-relaxed text-zinc-400"
					>
						カメラに相手のコードをかざすと、自動で接続されます。
					</div>
				</div>
			</section>
		{/if}
	</div>
</div>
