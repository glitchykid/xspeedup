<script lang="ts">
  import { onMount } from 'svelte';
  import { GraphicsLoad } from './stress/graphics';
  import { frameStats } from './stress/math';
  import CpuWorker from './stress/cpu.worker?worker';
  import type {
    TuningStatus,
    TuningState,
    Method,
    RequestMap,
    ResponseMap,
  } from '../../shared/contracts';
  let { t, onbusy }: { t: (key: string) => string; onbusy: (busy: boolean) => void } = $props();
  let canvas: HTMLCanvasElement;
  let status = $state<TuningStatus | null>(null);
  let active = $state(false),
    automatic = $state(false),
    stopped = false;
  let duration = $state(30),
    heavy = $state(true),
    cpu = $state(false);
  let elapsed = $state(0),
    stage = $state(0),
    temperature = $state<number | null>(null);
  let renderer = $state(''),
    triangles = $state(0),
    passes = $state(0),
    workerPasses = $state(0);
  let error = $state(''),
    outcome = $state(''),
    stats = $state(frameStats([]));
  let recovery = $state('');
  let session: TuningState | null = null;
  let load: GraphicsLoad | null = null;
  let workers: Worker[] = [];
  let samples: number[] = [];
  let rows = $state<
    { stage: number; core: number; memory: number | null; fps: number; low: number }[]
  >([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pollBusy = false,
    transitioning = false,
    failure: Error | null = null;
  let raf = 0;
  let interruptStage: (() => void) | undefined;
  const api = <M extends Method>(method: M, args: RequestMap[M]): Promise<ResponseMap[M]> => {
    if (!window.desktop) return Promise.reject(new Error(t('previewNote')));
    return window.desktop.request(method, args);
  };
  async function inspect() {
    try {
      status = await api('tuning.status', {});
    } catch (e) {
      error = String(e);
    }
  }
  function stop() {
    stopped = true;
    interruptStage?.();
  }
  function fail(e: unknown) {
    failure = e instanceof Error ? e : new Error(String(e));
    stop();
  }
  async function pulse() {
    if (pollBusy || transitioning || !active) return;
    pollBusy = true;
    try {
      if (session) {
        const current = await api('tuning.heartbeat', { id: session.id });
        temperature = current.temperature;
      } else {
        const info = await api('tuning.status', {});
        temperature = info.devices.find((d) => d.id)?.temperature ?? null;
        if (temperature !== null && temperature >= 75) fail(new Error(t('thermalStop')));
      }
    } catch (e) {
      fail(e);
    } finally {
      pollBusy = false;
    }
  }
  function runStage(seconds: number) {
    samples = [];
    stats = frameStats([]);
    return new Promise<void>((resolve, reject) => {
      const start = performance.now();
      let last = start,
        lastProbe = -1000;
      const initialPasses = passes;
      const finish = () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        interruptStage = undefined;
        failure ? reject(failure) : resolve();
      };
      interruptStage = finish;
      timer = setTimeout(
        () => {
          if (!stopped) {
            failure = new Error(t('renderStalled'));
            finish();
          }
        },
        seconds * 1000 + 2000,
      );
      function frame(now: number) {
        try {
          if (stopped) {
            finish();
            return;
          }
          elapsed = (now - start) / 1000;
          load!.render(now / 1000);
          if (now - lastProbe >= 1000) {
            load!.verify(passes + 1701);
            passes++;
            stats = frameStats(samples);
            lastProbe = now;
          }
          if (now - start > 1000) samples.push(now - last);
          last = now;
          if (elapsed >= seconds) {
            if (samples.length < 2 || passes - initialPasses < Math.max(2, Math.floor(seconds / 3)))
              failure = new Error(t('renderStalled'));
            stats = frameStats(samples);
            finish();
          } else raf = requestAnimationFrame(frame);
        } catch (e) {
          failure = e instanceof Error ? e : new Error(String(e));
          finish();
        }
      }
      raf = requestAnimationFrame(frame);
    });
  }
  async function start(tune = false) {
    if (active) return;
    active = true;
    onbusy(true);
    automatic = tune;
    stopped = false;
    transitioning = false;
    failure = null;
    error = '';
    outcome = '';
    recovery = '';
    rows = [];
    passes = 0;
    workerPasses = 0;
    elapsed = 0;
    stage = 0;
    try {
      canvas.width = heavy ? 1280 : 640;
      canvas.height = heavy ? 720 : 360;
      load = new GraphicsLoad(canvas, heavy || tune);
      renderer = load.renderer;
      triangles = load.triangles;
      if (/swiftshader|llvmpipe|software|warp/i.test(renderer)) throw new Error(t('softwareGpu'));
      if (tune) {
        const available = status?.devices.filter((d) => d.id) ?? [];
        const device = available[0];
        if (
          available.length !== 1 ||
          !device?.canTune ||
          !renderer.toLowerCase().includes(device.name.toLowerCase())
        )
          throw new Error(t('gpuMismatch'));
        session = await api('tuning.start', { deviceId: device.id });
      }
      if (cpu) {
        const count = Math.max(1, Math.min(8, navigator.hardwareConcurrency - 1));
        const done = new Map<number, number>();
        workers = Array.from({ length: count }, (_, id) => {
          const worker = new CpuWorker();
          worker.onmessage = ({ data }) => {
            if (data.errors) fail(new Error(t('cpuMismatch')));
            done.set(id, data.passes);
            workerPasses = [...done.values()].reduce((a, b) => a + b, 0);
          };
          worker.onerror = () => fail(new Error(t('cpuMismatch')));
          worker.postMessage({ seed: id + 1337, bytes: 16 * 1024 * 1024 });
          return worker;
        });
      }
      await pulse();
      if (failure) throw failure;
      heartbeat = setInterval(() => {
        void pulse();
      }, 3000);
      if (tune) {
        while (session && !stopped) {
          stage = session.stage;
          await runStage(session.more ? 46 : 121);
          if (stopped) break;
          rows.push({
            stage,
            core: session.core,
            memory: session.memory,
            fps: stats.fps,
            low: stats.low,
          });
          // Avoid overlapping heartbeat requests with a stage transition.
          transitioning = true;
          while (pollBusy) await new Promise((resolve) => setTimeout(resolve, 30));
          if (failure) throw failure;
          if (stopped) break;
          if (!session.more) {
            clearInterval(heartbeat);
            const result = await api('tuning.finish', { id: session.id, completed: true });
            recovery = result.message;
            if (result.skipped) throw new Error(t('recoveryNeeded'));
            session = null;
            outcome = 'tuneDone';
            break;
          }
          session = await api('tuning.advance', { id: session.id });
          transitioning = false;
        }
      } else {
        await runStage(duration);
        outcome = stopped ? 'scanStopped' : 'stressDone';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      transitioning = true;
      clearInterval(heartbeat);
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      workers.forEach((w) => w.terminate());
      workers = [];
      while (pollBusy) await new Promise((resolve) => setTimeout(resolve, 30));
      if (session) {
        try {
          const result = await api('tuning.finish', { id: session.id, completed: false });
          recovery = result.message;
          if (result.skipped) error = t('recoveryNeeded');
        } catch (e) {
          recovery = String(e);
          error ||= t('recoveryNeeded');
        }
      }
      session = null;
      load?.dispose();
      load = null;
      active = false;
      onbusy(false);
      await inspect();
    }
  }
  onMount(() => {
    void inspect();
    const hidden = () => {
      if (document.hidden && active) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      clearInterval(heartbeat);
      workers.forEach((w) => w.terminate());
      load?.dispose();
      document.removeEventListener('visibilitychange', hidden);
    };
  });
</script>

<div class="notice"><p>{t('stressNote')}</p></div>
<div class="hardware-grid">
  {#each status?.devices ?? [] as device}<article class="panel hardware-card">
      <span class="eyebrow">GPU</span><strong>{device.name}</strong>
      <p>{t(device.canTune ? 'tuneAvailable' : 'tuneUnavailable')}</p>
      {#if device.temperature !== null}<span>{device.temperature} °C</span>{/if}
      <details>
        <summary>{t('details')}</summary>
        <p>{device.reason || 'NVML clock offsets (P0)'}</p>
      </details>
    </article>{/each}
  <article class="panel hardware-card">
    <span class="eyebrow">CPU / RAM</span><strong>{status?.cpu ?? 'CPU'}</strong>
    <p>{t('cpuTuningUnavailable')}</p>
  </article>
</div>
{#if status?.pending.length}<div class="notice error"><p>{t('recoveryNeeded')}</p></div>{/if}
<div class="bench-options panel">
  <label
    >{t('duration')}<select aria-label={t('duration')} bind:value={duration} disabled={active}
      ><option value={3}>{t('quickCheck')}</option><option value={30}>30 s</option><option
        value={180}>180 s</option
      ><option value={600}>600 s</option></select
    ></label
  >
  <label
    ><input type="checkbox" bind:checked={heavy} disabled={active} />{t('complexGeometry')}</label
  >
  <label><input type="checkbox" bind:checked={cpu} disabled={active} />{t('cpuLoad')}</label>
</div>
<div class="benchmark panel">
  <canvas bind:this={canvas} aria-label={t('stressScene')}></canvas>
  <div class="bench-hud">
    <span>{elapsed.toFixed(1)} s</span><span>{stats.fps.toFixed(1)} FPS</span><span
      >1% low: {stats.low.toFixed(1)}</span
    ><span>P99: {stats.p99.toFixed(1)} ms</span><span
      >{temperature === null ? '—' : `${temperature} °C`}</span
    >{#if automatic}<span>{t('stage')}: {stage}</span>{/if}
  </div>
</div>
<p class="page-note">
  {renderer || t('stressIdle')} · {triangles.toLocaleString()}
  {t('triangles')} · GPU: {passes} / CPU: {workerPasses}
  {t('checks')}
</p>
{#if error}<div class="notice error" role="alert">{error}</div>{/if}
{#if outcome}<div class="notice success" role="status">{t(outcome)}</div>{/if}
{#if recovery}<details class="notice">
    <summary>{t('details')}</summary>
    <p>{recovery}</p>
  </details>{/if}
{#if rows.length}<div class="panel bench-results">
    {#each rows as row}<p>
        {t('stage')}
        {row.stage}: GPU {row.core} MHz / VRAM {row.memory ?? '—'} MHz · {row.fps.toFixed(1)} FPS · 1%
        low {row.low.toFixed(1)}
      </p>{/each}
  </div>{/if}
<div class="action-bar">
  <span>{t('hardwareAuto')}</span>{#if active}<button class="primary" onclick={stop}
      >{t('stopScan')}</button
    >{:else}<button class="secondary" onclick={() => start()} disabled={!window.desktop}
      >{t('stressStart')}</button
    ><button
      class="primary"
      onclick={() => start(true)}
      disabled={!status?.devices.some((d) => d.canTune) || !!status?.pending.length}
      >{t('autoTune')}</button
    >{/if}
</div>
