<script lang="ts">
  import { createTranslator, validLocale } from '../../shared/i18n';
  import { onMount } from 'svelte';
  import { GraphicsLoad } from './stress/graphics';
  import { frameStats } from './stress/math';
  import { allWorkersVerified } from './stress/workers';
  import CpuWorker from './stress/cpu.worker?worker';
  import type {
    TuningStatus,
    TuningState,
    Method,
    RequestMap,
    ResponseMap,
  } from '../../shared/contracts';
  let t = $state(createTranslator(validLocale(document.documentElement.lang)));
  let stepSeconds = 45,
    ram = false;
  let ssao = $state(true),
    bloom = $state(true),
    shadows = $state(true);
  let closing = false,
    initializing = true;
  async function close() {
    if (active || initializing) {
      closing = true;
      stop();
    } else await api('bench.close', {});
  }
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
  let workerCounts = new Map<number, number>();
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
      const initialWorkers = new Map(workerCounts);
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
            const stageWorkers = new Map(
              [...workerCounts].map(([id, count]) => [id, count - (initialWorkers.get(id) ?? 0)]),
            );
            if (!allWorkersVerified(stageWorkers, workers.length))
              failure = new Error(t('cpuMismatch'));
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
      load = new GraphicsLoad(canvas, heavy || tune, { ssao, bloom, shadows });
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
        session = await api('tuning.start', { deviceId: device.id, stepSeconds });
      }
      if (cpu || ram) {
        const count = Math.max(1, Math.min(8, navigator.hardwareConcurrency - 1));
        workerCounts = new Map<number, number>();
        workers = Array.from({ length: count }, (_, id) => {
          const worker = new CpuWorker();
          worker.onmessage = ({ data }) => {
            if (data.errors) fail(new Error(t('cpuMismatch')));
            workerCounts.set(id, data.passes);
            workerPasses = [...workerCounts.values()].reduce((a, b) => a + b, 0);
          };
          worker.onerror = () => fail(new Error(t('cpuMismatch')));
          worker.postMessage({ seed: id + 1337, bytes: (ram ? 32 : 1) * 1024 * 1024, cpu });
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
          await runStage(session.more ? stepSeconds + 1 : 121);
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
        outcome = stopped ? 'stressStopped' : 'stressDone';
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
      await api('bench.complete', {});
      if (closing && !error) await api('bench.close', {});
    }
  }
  onMount(() => {
    const initialize = async () => {
      try {
        const config = await api('bench.config', {});
        document.documentElement.lang = config.locale;
        t = createTranslator(validLocale(config.locale));
        ({ duration, heavy, cpu, ram, stepSeconds, ssao, bloom, shadows } = config.options);
        // Let the window creation IPC settle before requesting the agent.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await inspect();
        initializing = false;
        if (closing) {
          await api('bench.complete', {});
          await api('bench.close', {});
        } else if (!error) await start(config.options.automatic);
        else await api('bench.complete', {});
      } catch (e) {
        initializing = false;
        error = String(e);
        await api('bench.complete', {});
      }
    };
    void initialize();
    const unsubscribe = window.desktop?.onBenchStop(() => {
      void close();
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void close();
      }
    };
    document.addEventListener('keydown', key);
    const hidden = () => {
      if (document.hidden && active) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe?.();
      document.removeEventListener('keydown', key);
      stop();
      clearInterval(heartbeat);
      workers.forEach((w) => w.terminate());
      load?.dispose();
      document.removeEventListener('visibilitychange', hidden);
    };
  });
</script>

<div class="fullscreen-bench">
  <canvas bind:this={canvas} aria-label={t('stressScene')}></canvas>
  <header class="benchmark-header">
    <div><strong>X SpeedUp / STRESS LAB</strong><span>{renderer || t('stressIdle')}</span></div>
    <button class="primary" onclick={close}>{t(active ? 'stopTest' : 'close')} · Esc</button>
  </header>
  <div class="benchmark-footer">
    <div class="bench-hud">
      <span>{elapsed.toFixed(1)} s</span><span>{stats.fps.toFixed(1)} FPS</span><span
        >1% low {stats.low.toFixed(1)}</span
      ><span>P99 {stats.p99.toFixed(1)} ms</span><span>{temperature ?? '—'} °C</span><span
        >{t('stage')} {stage}</span
      >
    </div>
    <p class="bench-checks">
      {triangles.toLocaleString()}
      {t('triangles')} · GPU: {passes} / CPU+RAM: {workerPasses}
      {t('checks')} · {ssao ? 'SSAO · ' : ''}{shadows ? `PCF ${t('dynamicShadows')} · ` : ''}{bloom
        ? 'HDR bloom · '
        : ''}16 {t('lights')} · FXAA
    </p>
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if outcome}<div class="notice success" role="status">{t(outcome)}</div>{/if}
    {#if recovery}<p class="recovery">{recovery}</p>{/if}
    {#if rows.length}<div class="benchmark-results">
        {#each rows as row}<span
            >{t('stage')}
            {row.stage}: {row.core}/{row.memory ?? '—'} MHz · {row.fps.toFixed(1)} FPS · 1% {row.low.toFixed(
              1,
            )}</span
          >{/each}
      </div>{/if}
  </div>
</div>
