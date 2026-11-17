<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import Switcher from '../../components/Switcher.svelte';
	import { audioConstraints } from '$lib/charms/audio';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { roleOf } from '$lib/roles';
	import { onDestroy } from 'svelte';

	const session = new ClientSession('controller');
	const role = roleOf('controller');

	/** インカムで送っている、この端末のマイクの声 */
	let talkStream: MediaStream | null = null;
	let talking = $state(false);
	let talkBusy = $state(false);
	let talkError = $state<string | null>(null);

	/** インカムを聞く設定にしているカメラ・テロップ */
	const listeners = $derived(session.snapshot.nodes.filter((node) => node.listening));

	onDestroy(() => talkStream?.getTracks().forEach((track) => track.stop()));

	/** インカムを入れる・切る */
	async function toggleTalk() {
		talkBusy = true;
		talkError = null;
		try {
			if (talking) {
				talkStream?.getTracks().forEach((track) => track.stop());
				talkStream = null;
				talking = false;
				session.setStatus({ talking: false });
				await session.media.setTalkStream(null);
			} else {
				talkStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints('voice') });
				await session.media.setTalkStream(talkStream);
				talking = true;
				// ホストが、聞く設定にしているカメラへ声を届ける接続を張る
				session.setStatus({ talking: true });
			}
		} catch {
			talkError = 'マイクを使えませんでした。ブラウザのアドレス欄の横から、マイクを「許可」に変えてください。';
		} finally {
			talkBusy = false;
		}
	}
</script>

<svelte:head>
	<title>スイッチャー — CHARM Point</title>
</svelte:head>

<NodeShell {session} {role}>
	<div class="space-y-4">
		<Switcher api={session} />

		<section class="panel" aria-label="インカム">
			<div class="panel-head">
				<h2 class="panel-title">インカム（声で指示する）</h2>
				<span class="hint">
					{listeners.length > 0
						? `聞いている端末: ${listeners.map((node) => node.name).join('、')}`
						: '聞いている端末はありません'}
				</span>
			</div>
			<div class="flex flex-wrap items-center gap-3 p-3">
				<button
					type="button"
					class="btn {talking ? 'btn-danger' : ''}"
					aria-pressed={talking}
					disabled={talkBusy}
					onclick={toggleTalk}
				>
					{talking ? '■ インカムを切る' : 'インカムを入れる'}
				</button>
				<p class="hint min-w-0 flex-1">
					{#if talking}
						<span class="text-red-300">この端末のマイクの声が、聞いている端末に届いています。</span>
					{:else}
						入れている間、この端末のマイクの声が、カメラの画面で「インカムを聞く」をオンにした端末に届きます。モニターには流れません。
					{/if}
				</p>
				{#if talkError}
					<p class="w-full text-sm text-red-300" role="alert">{talkError}</p>
				{/if}
			</div>
		</section>

		<div class="panel p-4">
			<NameEditor name={session.name} onRename={(name) => session.rename(session.id, name)} />
		</div>
	</div>
</NodeShell>
