<script lang="ts">
	import NameEditor from '../../components/NameEditor.svelte';
	import NodeShell from '../../components/NodeShell.svelte';
	import Switcher from '../../components/Switcher.svelte';
	import { ClientSession } from '$lib/charms/client.svelte';
	import { roleOf } from '$lib/roles';

	const session = new ClientSession('controller');
	const role = roleOf('controller');
</script>

<svelte:head>
	<title>スイッチャー — CHARMS</title>
</svelte:head>

<NodeShell {session} {role}>
	<div class="space-y-4">
		<Switcher api={session} />
		<div class="panel p-4">
			<NameEditor name={session.name} onRename={(name) => session.rename(session.id, name)} />
		</div>
	</div>
</NodeShell>
