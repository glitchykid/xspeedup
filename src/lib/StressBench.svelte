<script lang="ts">
  import { onMount } from 'svelte';
  import Details from './Details.svelte';
  import type { TuningStatus, BenchOptions } from '../../shared/contracts';
  let { t, onbusy }: { t: (key: string) => string; onbusy: (busy: boolean) => void } = $props();
  let status = $state<TuningStatus | null>(null),
    error = $state(''),
    loading = $state(false);
  let tab = $state('GPU'),
    deviceIndex = $state(0);
  let duration = $state(30),
    heavy = $state(true),
    cpu = $state(false),
    ram = $state(false);
  let stepSeconds = $state(45),
    ssao = $state(true),
    bloom = $state(true),
    shadows = $state(true);
  const device = $derived(status?.devices[deviceIndex]);
  const signed = (value: number | undefined) =>
    value === undefined ? '—' : (value > 0 ? '+' : '') + value + ' MHz';
  async function inspect() {
    if (loading) return;
    loading = true;
    onbusy(true);
    error = '';
    try {
      status = (await window.desktop?.request('tuning.status', {})) ?? null;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      onbusy(false);
    }
  }
  async function open(automatic: boolean) {
    if (loading) return;
    error = '';
    onbusy(true);
    try {
      const options: BenchOptions = {
        duration,
        heavy,
        cpu,
        ram,
        automatic,
        stepSeconds,
        ssao,
        bloom,
        shadows,
      };
      await window.desktop!.request('bench.open', options);
    } catch (e) {
      error = String(e);
    } finally {
      onbusy(false);
    }
  }
  onMount(() => {
    void inspect();
    const refresh = () => {
      void inspect();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  });
</script>

<div class="inner-tabs">
  {#each ['GPU', 'CPU', 'RAM', 'SSD'] as name}<button
      class:active={tab === name}
      onclick={() => (tab = name)}>{name}</button
    >{/each}<button class="text-button" onclick={inspect}>{t('refresh')}</button>
</div>
<section class="panel hardware-detail">
  {#if tab === 'GPU'}
    {#if (status?.devices.length ?? 0) > 1}<select bind:value={deviceIndex} aria-label="GPU"
        >{#each status?.devices ?? [] as d, i}<option value={i}>{d.name}</option>{/each}</select
      >{/if}
    <h2>{device?.name ?? 'GPU'}</h2>
    <div class="hardware-metrics">
      <div>
        <span>{t('currentClock')} / GPU</span><strong
          >{device?.telemetry?.coreMHz ?? '—'} MHz</strong
        >
      </div>
      <div>
        <span>{t('currentClock')} / VRAM</span><strong
          >{device?.telemetry?.memoryMHz ?? '—'} MHz</strong
        >
      </div>
      <div>
        <span>{t('currentOffset')} / GPU</span><strong>{signed(device?.core?.current)}</strong>
      </div>
      <div>
        <span>{t('currentOffset')} / VRAM</span><strong>{signed(device?.memory?.current)}</strong>
      </div>
      <div>
        <span>{t('driverMax')} / GPU</span><strong
          >{device?.telemetry?.maxCoreMHz ?? '—'} MHz</strong
        >
      </div>
      <div>
        <span>{t('driverMax')} / VRAM</span><strong
          >{device?.telemetry?.maxMemoryMHz ?? '—'} MHz</strong
        >
      </div>
      <div>
        <span>{t('power')}</span><strong
          >{device?.telemetry?.watts ?? '—'} / {device?.telemetry?.powerLimitWatts ?? '—'} W</strong
        >
      </div>
      <div><span>{t('temperature')}</span><strong>{device?.temperature ?? '—'} °C</strong></div>
    </div>
    <p>{t(device?.canTune ? 'tuneAvailable' : 'tuneUnavailable')}</p>
    <p class="page-note">{t('offsetNote')}</p>
    <p class="page-note" title={device?.reason}>{device?.reason}</p>
  {:else if tab === 'CPU'}<h2>{status?.cpu ?? 'CPU'}</h2>
    <p>{status?.hardware.board}</p>
    <p>{t('cpuControlNote')}</p>
  {:else if tab === 'RAM'}<h2>RAM</h2>
    <div class="hardware-metrics">
      {#each status?.hardware.memory ?? [] as item}<div>
          <span>{item.name}</span><strong
            >{(item.capacity / 1073741824).toFixed(1)} GB · {item.configuredMHz ?? '—'} MHz</strong
          ><small>{t('ratedClock')}: {item.ratedMHz ?? '—'} MHz</small>
        </div>{/each}
    </div>
    <p>{t('ramControlNote')}</p>
  {:else}<h2>{t('storage')}</h2>
    <div class="hardware-metrics">
      {#each status?.hardware.drives ?? [] as item}<div>
          <span>{item.name}</span><strong
            >{(item.bytes / 1000000000).toFixed(0)} GB · {item.connection}</strong
          >
        </div>{/each}
    </div>
    <p>{t('ssdControlNote')}</p>{/if}
</section>
<div class="bench-options panel">
  <label
    >{t('duration')}<select aria-label={t('duration')} bind:value={duration}
      ><option value={3}>{t('quickCheck')}</option><option value={30}>30 s</option><option
        value={180}>180 s</option
      ><option value={600}>600 s</option></select
    ></label
  >
  <label
    >{t('stepSeconds')}<input
      type="number"
      min="10"
      max="120"
      step="1"
      bind:value={stepSeconds}
    /></label
  >
  <label><input type="checkbox" bind:checked={heavy} />{t('complexGeometry')}</label>
  <label><input type="checkbox" bind:checked={cpu} />CPU</label><label
    ><input type="checkbox" bind:checked={ram} />RAM</label
  >
  <label><input type="checkbox" bind:checked={ssao} />SSAO</label><label
    ><input type="checkbox" bind:checked={shadows} />{t('dynamicShadows')}</label
  ><label><input type="checkbox" bind:checked={bloom} />HDR / Bloom</label>
</div>
<p class="page-note">{t('fullscreenNote')}</p>
<div class="notice"><Details texts={[t('stressNote'), t('tuneNote')]} {t} /></div>
{#if status?.pending.length}<div class="notice error">{t('recoveryNeeded')}</div>{/if}
{#if error}<div class="notice error" role="alert">{error}</div>{/if}
<div class="action-bar">
  <span>{t('hardwareAuto')}</span><button
    class="secondary"
    onclick={() => open(false)}
    disabled={loading ||
      !window.desktop ||
      !Number.isInteger(stepSeconds) ||
      stepSeconds < 10 ||
      stepSeconds > 120}>{t('stressStart')}</button
  ><button
    class="primary"
    onclick={() => open(true)}
    disabled={loading ||
      !status?.devices.some((d) => d.canTune) ||
      !!status?.pending.length ||
      !Number.isInteger(stepSeconds) ||
      stepSeconds < 10 ||
      stepSeconds > 120}>{t('autoTune')}</button
  >
</div>
