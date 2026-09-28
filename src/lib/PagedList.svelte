<script lang="ts" generics="T">
  import { onMount, type Snippet } from 'svelte';
  let {
    items,
    rowHeight,
    t,
    children,
  }: { items: T[]; rowHeight: number; t: (key: string) => string; children: Snippet<[T[]]> } =
    $props();
  let host: HTMLDivElement,
    height = $state(200),
    page = $state(0);
  const size = $derived(Math.max(1, Math.floor((height - 34) / rowHeight)));
  const pages = $derived(Math.max(1, Math.ceil(items.length / size)));
  const current = $derived(Math.min(page, pages - 1));
  const entries = $derived(items.slice(current * size, (current + 1) * size));
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => (height = entry.contentRect.height));
    observer.observe(host);
    return () => observer.disconnect();
  });
</script>

<div class="paged-list" bind:this={host} style:--row-height={`${rowHeight}px`}>
  <div class="page-rows">{@render children(entries)}</div>
  <div class="pagination">
    <button class="secondary" disabled={current === 0} onclick={() => (page = current - 1)}
      >{t('previous')}</button
    ><span>{current + 1} / {pages} · {items.length}</span><button
      class="secondary"
      disabled={current + 1 >= pages}
      onclick={() => (page = current + 1)}>{t('next')}</button
    >
  </div>
</div>
