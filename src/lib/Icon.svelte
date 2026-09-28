<script lang="ts">
  import paths from '../../scripts/icon-paths.json';
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const icon = $derived(Object.hasOwn(paths, name) ? name : 'info');
</script>

<img
  class="raster-icon"
  src={`./images/icons/${icon}.png`}
  width={size}
  height={size}
  alt=""
  aria-hidden="true"
/>
