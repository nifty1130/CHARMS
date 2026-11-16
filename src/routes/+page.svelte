<script lang="ts">
  import type { Node } from '../rtc/types';

  // 仮のデータ
  let nodes: Node[] = [
    { id: 'cam-01', role: 'camera' },
    { id: 'mon-01', role: 'monitor' }
  ];
</script>

<h1>CHARMsExEx Host</h1>
<ul>
  {#each nodes as node}
    <li><strong>{node.id}</strong> - {node.role}</li>
  {/each}
</ul>