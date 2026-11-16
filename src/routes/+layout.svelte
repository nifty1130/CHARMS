<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<div class="min-h-dvh bg-zinc-950 text-zinc-100">
	{@render children()}
</div>
