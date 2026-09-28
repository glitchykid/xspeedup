<script lang="ts">
  import Icon from './Icon.svelte';
  let { name, size = 24 }: { name: string; size?: number } = $props();
</script>

<span class="raster-wrap" aria-hidden="true"><Icon {name} {size} /></span>
