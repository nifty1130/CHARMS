<script lang="ts">
	interface Props {
		/** いまの名前 */
		name: string;
		/** 名前を変えたとき */
		onRename: (name: string) => void;
		/** 入力欄の説明 */
		label?: string;
	}

	let { name, onRename, label = 'この端末の名前' }: Props = $props();

	let editing = $state(false);
	let draft = $state('');

	function open() {
		draft = name;
		editing = true;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const next = draft.trim();
		if (next && next !== name) onRename(next);
		editing = false;
	}
</script>

{#if editing}
	<form class="flex flex-wrap items-end gap-2" onsubmit={submit}>
		<label class="min-w-40 flex-1">
			<span class="text-sm text-zinc-300">{label}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="field mt-1" bind:value={draft} maxlength="24" autofocus />
		</label>
		<button type="submit" class="btn btn-primary" disabled={!draft.trim()}>決定</button>
		<button type="button" class="btn" onclick={() => (editing = false)}>やめる</button>
	</form>
{:else}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		<span class="text-sm text-zinc-400">{label}</span>
		<span class="text-base font-semibold text-zinc-100">{name}</span>
		<button type="button" class="btn btn-quiet" onclick={open}>名前を変える</button>
	</div>
{/if}
