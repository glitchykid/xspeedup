<script lang="ts">
  let { name, size = 34 }: { name: string; size?: number } = $props();
  const cells: Record<string, number> = {
    grid: 0,
    clean: 1,
    folder: 2,
    registry: 3,
    sliders: 4,
    memory: 5,
    history: 6,
    bolt: 7,
  };
  const index = $derived(cells[name] ?? 0);
</script>

<span
  class="generated-icon"
  aria-hidden="true"
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:background-position={`${(index % 4) * (100 / 3)}% ${index < 4 ? 0 : 100}%`}
></span>
