<script lang="ts">
	import type { ClientSession } from '$lib/charms/client.svelte';
	import { formatRoomCode, normalizeRoomCode } from '$lib/charms/room';

	/**
	 * 端末の画面に出す、合言葉の入力欄と、つなぐ手続きの進み具合
	 */
	interface Props {
		session: ClientSession;
	}

	let { session }: Props = $props();

	let draft = $state('');
	let invalid = $state(false);

	const busy = $derived(session.joinState !== 'idle');

	const status = $derived.by(() => {
		const code = session.room ? formatRoomCode(session.room) : '';
		switch (session.joinState) {
			case 'connecting':
				return { tone: 'busy', text: `合言葉 ${code} のホストを探しています…` } as const;
			case 'waiting':
				return {
					tone: 'wait',
					text: `合言葉 ${code} のホストが、まだ開かれていません。開かれたら自動でつながります。合言葉が合っているか確かめてください。`
				} as const;
			case 'joining':
				return { tone: 'busy', text: `合言葉 ${code} のホストとつないでいます…` } as const;
			case 'offline':
				return {
					tone: 'wait',
					text: 'インターネットにつながっていないため、合言葉を使えません。つながり次第、自動で試します。下の QR コードでもつなげます。'
				} as const;
			case 'full':
				return { tone: 'error', text: 'このホストには、これ以上つなげません（満員です）。' } as const;
			default:
				return null;
		}
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const code = normalizeRoomCode(draft);
		invalid = !code;
		if (code && session.joinRoom(code)) draft = '';
	}
</script>

<section class="panel" aria-label="合言葉でつなぐ">
	<div class="panel-head">
		<h2 class="panel-title">合言葉でつなぐ</h2>
		<span class="hint">インターネットが必要</span>
	</div>

	{#if busy && status}
		<div class="flex flex-wrap items-center gap-3 p-4" role="status" aria-live="polite">
			<span
				class="size-2.5 shrink-0 rounded-full {status.tone === 'busy'
					? 'animate-pulse bg-amber-400'
					: status.tone === 'error'
						? 'bg-red-500'
						: 'bg-zinc-500'}"
			></span>
			<p class="min-w-0 flex-1 text-base {status.tone === 'error' ? 'text-red-300' : 'text-zinc-100'}">
				{status.text}
			</p>
			<button type="button" class="btn" onclick={() => session.cancelJoin()}>やめる</button>
		</div>
	{:else}
		<form class="flex flex-wrap items-end gap-3 p-4" onsubmit={submit}>
			<div class="min-w-0 flex-1">
				<label class="text-sm font-medium text-zinc-200" for="room-code">
					ホストの画面に出ている、6桁の合言葉
				</label>
				<input
					id="room-code"
					class="field mt-1 max-w-64 font-mono text-2xl tracking-[0.2em]"
					bind:value={draft}
					inputmode="numeric"
					autocomplete="off"
					maxlength="9"
					placeholder="123 456"
					aria-invalid={invalid}
					oninput={() => (invalid = false)}
				/>
				{#if invalid}
					<p class="mt-1 text-sm text-amber-300" role="alert">合言葉は6桁の数字です。</p>
				{/if}
			</div>
			<button type="submit" class="btn btn-primary" disabled={!draft.trim()}>つなぐ</button>
		</form>
	{/if}
</section>
