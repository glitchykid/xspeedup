<script lang="ts">
  import PagedList from './PagedList.svelte';
  let { texts, t }: { texts: string[]; t: (key: string) => string } = $props();
  let dialog: HTMLDialogElement;
  const chunks = $derived(
    texts.flatMap((text) => {
      const chars = Array.from(text);
      return Array.from({ length: Math.ceil(chars.length / 220) }, (_, i) =>
        chars.slice(i * 220, (i + 1) * 220).join(''),
      );
    }),
  );
</script>

<button class="details-button" onclick={() => dialog.showModal()}>{t('details')}</button>
<dialog class="details-dialog" bind:this={dialog}>
  <div class="section-heading">
    <h2>{t('details')}</h2>
    <button class="secondary" onclick={() => dialog.close()}>{t('close')}</button>
  </div>
  <PagedList items={chunks} rowHeight={80} {t}
    >{#snippet children(items)}{#each items as text}<p class="detail-text">
          {text}
        </p>{/each}{/snippet}</PagedList
  >
</dialog>
