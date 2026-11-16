<script lang="ts">
	import type { NodeInfo } from '../types';

	// 仮のデータ（画面は feat/web-gui ブランチで実装中）
	const nodes: NodeInfo[] = [
		{ id: 'cam1', role: 'camera', name: 'カメラ 1' },
		{ id: 'mon1', role: 'monitor', name: 'モニター 1' }
	];
</script>

<h1>CHARMsExEx Host</h1>
<ul>
	{#each nodes as node (node.id)}
		<li><strong>{node.name}</strong> - {node.role}</li>
	{/each}
</ul>
