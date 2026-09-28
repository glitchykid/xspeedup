<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './lib/Icon.svelte';
  import ArtIcon from './lib/ArtIcon.svelte';
  import SelectAll from './lib/SelectAll.svelte';
  import StressBench from './lib/StressBench.svelte';
  import { bytes, date } from './lib/format';
  import { applyPreferences, preferredLocale } from './lib/preferences';
  import { createTranslator, locales, localeNames } from '../shared/i18n';
  import type {
    ActionResult,
    CleanupScan,
    FolderScan,
    GameStatus,
    HistoryItem,
    Method,
    ProcessItem,
    RegistryScan,
    RequestMap,
    ResponseMap,
    ServiceItem,
    SystemInfo,
  } from '../shared/contracts';
  type Page =
    | 'overview'
    | 'cleanup'
    | 'folders'
    | 'registry'
    | 'services'
    | 'processes'
    | 'history'
    | 'gaming'
    | 'stress';
  const pages: { id: Page; icon: string }[] = [
    { id: 'overview', icon: 'grid' },
    { id: 'gaming', icon: 'bolt' },
    { id: 'stress', icon: 'sliders' },
    { id: 'cleanup', icon: 'clean' },
    { id: 'folders', icon: 'folder' },
    { id: 'registry', icon: 'registry' },
    { id: 'services', icon: 'sliders' },
    { id: 'processes', icon: 'memory' },
    { id: 'history', icon: 'history' },
  ];
  let language = $state(preferredLocale());
  const t = $derived(createTranslator(language));
  const fmt = (value: number) => bytes(value, language);
  let page = $state<Page>('overview');
  let system = $state<SystemInfo | null>(null);
  let scan = $state<CleanupScan | null>(null);
  let folders = $state<FolderScan | null>(null);
  let registry = $state<RegistryScan | null>(null);
  let services = $state<ServiceItem[]>([]);
  let gaming = $state<GameStatus | null>(null);
  let gameServices = $state<string[]>([]);
  let gameProcesses = $state<string[]>([]);
  let processes = $state<ProcessItem[]>([]);
  let history = $state<HistoryItem[]>([]);
  let selectedCategories = $state<string[]>([]);
  let selectedFolders = $state<string[]>([]);
  let selectedEntries = $state<string[]>([]);
  let selectedServices = $state<string[]>([]);
  let busy = $state(false);
  let error = $state('');
  let result = $state<ActionResult | null>(null);
  let search = $state('');
  let folderSearch = $state('');
  let folderPath = $state('');
  let folderScope = $state<'all' | 'selected'>('all');
  let folderScanning = $state(false);
  let folderStop = $state(false);
  let folderPage = $state(0);
  const folderPageSize = 100;
  let profile = $state('');
  let resultKind = $state('');
  const desktop = window.desktop;
  const memoryPercent = $derived(
    system ? Math.round((1 - system.availableMemory / system.totalMemory) * 100) : 0,
  );
  const drivePercent = $derived(
    system ? Math.round((1 - system.driveFree / system.driveTotal) * 100) : 0,
  );
  const totalBytes = $derived(scan?.categories.reduce((sum, c) => sum + c.bytes, 0) ?? 0);
  const selectedBytes = $derived(
    scan?.categories
      .filter((c) => selectedCategories.includes(c.id))
      .reduce((sum, c) => sum + c.bytes, 0) ?? 0,
  );
  const visibleProcesses = $derived(
    processes.filter((p) => `${p.name} ${p.title}`.toLowerCase().includes(search.toLowerCase())),
  );
  const visibleFolders = $derived(
    (folders?.entries ?? []).filter((f) =>
      f.path.toLowerCase().includes(folderSearch.toLowerCase()),
    ),
  );
  const folderPages = $derived(Math.max(1, Math.ceil(visibleFolders.length / folderPageSize)));
  const currentFolderPage = $derived(Math.min(folderPage, folderPages - 1));
  const pageFolders = $derived(
    visibleFolders.slice(
      currentFolderPage * folderPageSize,
      (currentFolderPage + 1) * folderPageSize,
    ),
  );
  $effect(() => {
    applyPreferences('dark', language);
  });
  async function request<M extends Method>(
    method: M,
    args: RequestMap[M],
  ): Promise<ResponseMap[M]> {
    if (!desktop) throw new Error(t('previewNote'));
    return desktop.request(method, $state.snapshot(args) as RequestMap[M]);
  }
  async function task(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    result = null;
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function refreshSystem() {
    system = await request('system', {});
    gaming = await request('gaming.status', {});
  }
  async function navigate(next: Page) {
    if (busy) return;
    page = next;
    error = '';
    result = null;
    if (!desktop) return;
    if (next === 'gaming')
      await task(async () => {
        gaming = await request('gaming.status', {});
        processes = await request('processes.list', {});
        gameServices = [];
        gameProcesses = [];
      });
    if (next === 'services')
      await task(async () => {
        services = await request('services.list', {});
        selectedServices = [];
        profile = '';
      });
    if (next === 'processes')
      await task(async () => {
        processes = await request('processes.list', {});
      });
    if (next === 'history')
      await task(async () => {
        history = await request('history.list', {});
      });
  }
  async function scanFiles() {
    await task(async () => {
      scan = await request('cleanup.scan', {});
      selectedCategories = [];
      page = 'cleanup';
    });
  }
  async function scanRegistry() {
    await task(async () => {
      registry = await request('registry.scan', {});
      selectedEntries = [];
    });
  }
  async function chooseFolder() {
    await task(async () => {
      const chosen = await request('folders.choose', {});
      if (chosen) {
        folderPath = chosen;
        folderScope = 'selected';
        folders = null;
        selectedFolders = [];
      }
    });
  }
  async function scanFolders() {
    await task(async () => {
      folderScanning = true;
      folderStop = false;
      folders = null;
      selectedFolders = [];
      folderPage = 0;
      try {
        let current: FolderScan = await request('folders.scan', { scope: folderScope });
        folders = current;
        while (!current.complete && !folderStop) {
          const batch: FolderScan = await request('folders.continue', { scanId: current.id });
          current = { ...batch, entries: [...current.entries, ...batch.entries] };
          folders = current;
        }
        if (folderStop && !current.complete)
          folders = await request('folders.cancel', { scanId: current.id });
      } finally {
        folderScanning = false;
      }
    });
  }
  async function applyCleanup() {
    if (!scan) return;
    await task(async () => {
      resultKind = 'cleanup';
      result = await request('cleanup.apply', {
        scanId: scan!.id,
        categoryIds: selectedCategories,
      });
      scan = null;
      selectedCategories = [];
      await refreshSystem();
    });
  }
  async function applyFolders() {
    if (!folders) return;
    await task(async () => {
      resultKind = 'folders';
      result = await request('folders.apply', {
        scanId: folders!.id,
        entryIds: selectedFolders.length === folders!.entries.length ? 'all' : selectedFolders,
      });
      folders = null;
      selectedFolders = [];
    });
  }
  async function applyRegistry() {
    if (!registry) return;
    await task(async () => {
      resultKind = 'registry';
      result = await request('registry.apply', {
        scanId: registry!.id,
        entryIds:
          selectedEntries.length === registry!.entries.filter((e) => e.canChange).length
            ? 'all'
            : selectedEntries,
      });
      registry = null;
      selectedEntries = [];
    });
  }
  function selectProfile(id: string) {
    profile = id;
    selectedServices = services
      .filter((s) => s.canChange && s.profiles.includes(id))
      .map((s) => s.id);
  }
  async function applyServices() {
    await task(async () => {
      resultKind = 'services';
      result = await request('services.disable', { serviceIds: selectedServices });
      services = await request('services.list', {});
      selectedServices = [];
      profile = '';
    });
  }
  async function manageProcess(process: ProcessItem, memory = false) {
    await task(async () => {
      resultKind = memory ? 'ram' : 'processes';
      result = await request(memory ? 'memory.release' : 'processes.close', {
        processId: process.id,
        startTime: process.startTime,
      });
      processes = await request('processes.list', {});
      await refreshSystem();
    });
  }
  async function restore(id: string) {
    await task(async () => {
      resultKind = 'restore';
      result = await request('history.restore', { id });
      history = await request('history.list', {});
      gaming = await request('gaming.status', {});
    });
  }
  async function gameAction(stop = false) {
    await task(async () => {
      resultKind = 'gaming';
      try {
        result = stop
          ? await request('gaming.stop', {})
          : await request('gaming.start', {
              serviceIds: gameServices,
              processes: processes
                .filter((p) => gameProcesses.includes(String(p.id)))
                .map((p) => ({ id: p.id, startTime: p.startTime })),
            });
      } finally {
        gaming = await request('gaming.status', {});
        processes = await request('processes.list', {});
        gameServices = [];
        gameProcesses = [];
      }
    });
  }
  function reason(key: string, text: string) {
    return t(
      text.startsWith('Пустой раздел')
        ? 'reason.empty'
        : key.includes('App Paths')
          ? 'reason.app'
          : key.includes('Uninstall')
            ? 'reason.uninstall'
            : 'reason.startup',
    );
  }
  function historyKind(kind: string) {
    return kind === 'registry-v2' ? 'registry' : kind === 'memory' ? 'ram' : kind;
  }
  onMount(() => {
    if (desktop) void task(refreshSystem);
  });
</script>

<div class="app-shell">
  <aside class="sidebar">
    <a
      class="brand"
      href="#overview"
      onclick={(e) => {
        e.preventDefault();
        void navigate('overview');
      }}
      aria-label="X SpeedUp"
      ><span class="brand-mark"
        ><img src="./images/app-icon.png" alt="" width="46" height="46" /></span
      ><span>X SpeedUp<small>WINDOWS UTILITY</small></span></a
    >
    <nav aria-label={t('tools')}>
      {#each pages as item}<button
          class:active={page === item.id}
          disabled={busy}
          onclick={() => navigate(item.id)}
          aria-label={t(item.id)}
          aria-current={page === item.id ? 'page' : undefined}
          ><ArtIcon name={item.icon} size={30} /><span>{t(item.id)}</span></button
        >{/each}
    </nav>
    <div class="sidebar-bottom">
      <div class="local-note">
        <Icon name="shield" size={20} /><strong>{t('local')}</strong>
        <p>{t('private')}</p>
      </div>
      <div class="version"><span class="status-dot"></span>X SpeedUp <span>v0.4.0</span></div>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <span class="breadcrumbs">{t(page)}</span>
      <div class="topbar-actions">
        <span class="connection"
          ><span class:offline={!system} class="status-dot"></span>{t(
            system ? 'connected' : desktop ? 'connecting' : 'preview',
          )}</span
        ><select class="language-select" aria-label={t('language')} bind:value={language}
          >{#each locales as locale, index}<option value={locale}>{localeNames[index]}</option
            >{/each}</select
        >
      </div>
    </header>
    <main
      class:with-actions={[
        'cleanup',
        'folders',
        'registry',
        'services',
        'gaming',
        'stress',
      ].includes(page)}
    >
      <div class="page-heading">
        <div>
          <span class="eyebrow">X SPEEDUP / {t(page)}</span>
          <h1>{t(`title.${page}`)}</h1>
        </div>
        <span class="mode-badge"
          ><Icon name="shield" size={15} />{t(system?.isAdmin ? 'admin' : 'manual')}</span
        >
      </div>
      {#if !desktop}<div class="notice">
          <Icon name="info" />
          <p>{t('previewNote')}</p>
        </div>{/if}
      {#if gaming?.sessionId && page !== 'gaming'}<div class="notice game-active">
          <Icon name="activity" /><strong>{t('gameActive')}</strong><button
            class="secondary"
            disabled={busy}
            onclick={() => navigate('gaming')}>{t('gaming')}</button
          >
        </div>{/if}
      {#if error}<div class="notice error" role="alert">
          <Icon name="info" />
          <div>
            <strong>{t('error')}</strong>
            <details>
              <summary>{t('details')}</summary>
              <p>{error}</p>
            </details>
          </div>
          <button class="icon-button" aria-label={t('close')} onclick={() => (error = '')}
            ><Icon name="close" /></button
          >
        </div>{/if}
      {#if result}<div class="notice success" role="status">
          <Icon name="check" />
          <div>
            <strong>{t('done')} · {t(resultKind)}</strong>
            <p>
              {t('changed')}: {result.changed} · {t('skipped')}: {result.skipped}{#if result.bytes > 0}
                · {fmt(result.bytes)}{/if}
            </p>
            <details>
              <summary>{t('details')}</summary>
              <p>{result.message}</p>
              {#each result.details ?? [] as detail}<p class="mono">{detail}</p>{/each}
            </details>
          </div>
        </div>{/if}
      {#if busy}<div class="working" role="status">
          <span class="spinner"></span>{t('working')}
        </div>{/if}
      {#if page === 'overview'}
        <section class="hero panel">
          <div class="hero-copy">
            <span class="pill">{t('local')}</span>
            <h2>{t('hero')}<br /><span>{t('heroAccent')}</span></h2>
            <p>{t('heroBody')}</p>
            <button class="primary" disabled={busy || !desktop} onclick={scanFiles}
              ><Icon name="search" size={18} />{t('analyze')}<Icon name="arrow" size={17} /></button
            ><span class="hero-footnote"><Icon name="shield" size={13} />{t('readOnly')}</span>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <img class="hero-art" src="./images/app-icon.png" alt="" width="320" height="320" />
          </div>
        </section>
        <div class="section-heading">
          <h2>{t('status')}</h2>
          <button
            class="text-button"
            disabled={busy || !desktop}
            onclick={() => task(refreshSystem)}
            ><Icon name="refresh" size={15} />{t('refresh')}</button
          >
        </div>
        <div class="metrics">
          <article class="metric panel">
            <div class="metric-label"><span>{t('disk')}</span><Icon name="disk" /></div>
            <div class="metric-value">
              {system ? fmt(system.driveFree) : '—'}<small>{t('free')}</small>
            </div>
            <div class="bar"><span style:width={`${drivePercent}%`}></span></div>
            <div class="metric-foot">
              {system
                ? `${fmt(system.driveTotal - system.driveFree)} ${t('of')} ${fmt(system.driveTotal)}`
                : '—'}
            </div>
          </article>
          <article class="metric panel">
            <div class="metric-label"><span>{t('ram')}</span><Icon name="memory" /></div>
            <div class="metric-value">
              {system ? `${memoryPercent}%` : '—'}<small>{t('used')}</small>
            </div>
            <div class="bar purple"><span style:width={`${memoryPercent}%`}></span></div>
            <div class="metric-foot">
              {system
                ? `${fmt(system.availableMemory)} ${t('free')} ${t('of')} ${fmt(system.totalMemory)}`
                : '—'}
            </div>
            <button
              class="text-button memory-link"
              disabled={busy}
              onclick={() => navigate('processes')}
              >{t('releaseMemory')}<Icon name="arrow" size={14} /></button
            >
          </article>
          <article class="metric panel">
            <div class="metric-label"><span>{t('uptime')}</span><Icon name="clock" /></div>
            <div class="metric-value">
              {system ? Math.floor(system.uptimeSeconds / 3600) : '—'}<small>{t('hours')}</small>
            </div>
            <div class="metric-foot">{system ? `${system.processorCount} ${t('cores')}` : '—'}</div>
          </article>
        </div>
        <div class="section-heading">
          <h2>{t('tools')}</h2>
          <span>{t('readOnly')}</span>
        </div>
        <div class="tool-grid">
          {#each pages.filter((p) => !['overview', 'history'].includes(p.id)) as tool}<button
              class="tool-card panel"
              disabled={busy}
              onclick={() => navigate(tool.id)}
              ><span class="tool-icon"><ArtIcon name={tool.icon} size={40} /></span><Icon
                name="arrow"
                size={17}
              />
              <h3>{t(tool.id)}</h3></button
            >{/each}
        </div>
        <footer class="system-footer">
          <Icon name="windows" size={16} /><span>{system?.os ?? 'Windows 10 / 11'}</span><span
            >{system?.machine ?? 'X SpeedUp'}</span
          >
        </footer>
      {:else if page === 'stress'}
        <StressBench {t} onbusy={(value) => (busy = value)} />
      {:else if page === 'gaming'}
        <div class="notice">
          <ArtIcon name="bolt" size={32} />
          <p>{t('gameNote')}</p>
        </div>
        <section class="game-summary panel">
          <div>
            <span class="eyebrow">{t('balanced')}</span>
            <h2>{t(gaming?.sessionId ? 'gameActive' : 'gameReady')}</h2>
            <p>
              {t('gameWindows')}:
              <strong
                >{t(
                  gaming?.windowsMode === 1
                    ? 'enabled'
                    : gaming?.windowsMode === 0
                      ? 'disabled'
                      : 'unknown',
                )}</strong
              >
            </p>
          </div>
          <button
            class="secondary"
            disabled={busy || !desktop}
            onclick={() =>
              task(async () => {
                await request('gaming.settings', {});
              })}>{t('windowsSettings')}</button
          >
          {#if gaming && !gaming.settingAvailable}<p class="page-note">
              {t('gameUnavailable')}
            </p>{/if}
        </section>
        <div class="section-heading">
          <h2>{t('gameServices')}</h2>
          <button class="text-button" disabled={busy} onclick={() => navigate('gaming')}
            >{t('refresh')}</button
          >
        </div>
        <SelectAll
          ids={(gaming?.services ?? []).filter((s) => s.canStop).map((s) => s.id)}
          bind:selected={gameServices}
          disabled={busy || !!gaming?.sessionId}
          label={t('selectAll')}
        />
        <div class="panel item-list">
          {#each gaming?.services ?? [] as service}<label class="select-row">
              <input
                type="checkbox"
                bind:group={gameServices}
                value={service.id}
                disabled={busy || !!gaming?.sessionId || !service.canStop}
              />
              <span class="row-copy"
                ><strong>{service.id}</strong><span>{t(`impact.${service.id}`)}</span><small
                  >{t(
                    service.state === 4
                      ? 'running'
                      : service.state === 1
                        ? 'stopped'
                        : 'unavailable',
                  )}{#if !system?.isAdmin}
                    · {t('requiresAdmin')}{/if}</small
                ></span
              >
            </label>{/each}
        </div>
        <div class="section-heading">
          <h2>{t('gameApps')}</h2>
          <span>{t('gameAppsNote')}</span>
        </div>
        <SelectAll
          ids={processes.map((p) => String(p.id))}
          bind:selected={gameProcesses}
          disabled={busy || !!gaming?.sessionId}
          label={t('selectAll')}
        />
        <div class="panel item-list">
          {#each processes as process}<label class="select-row">
              <input
                type="checkbox"
                bind:group={gameProcesses}
                value={String(process.id)}
                disabled={busy || !!gaming?.sessionId}
              />
              <span class="row-copy"
                ><strong>{process.name}</strong><small>{process.title}</small></span
              ><span>{fmt(process.memory)}</span>
            </label>{:else}<div class="empty">{t('nothing')}</div>{/each}
        </div>
        <div class="action-bar">
          <span>{t('selected')}: <strong>{gameServices.length + gameProcesses.length}</strong></span
          >
          {#if gaming?.sessionId}<button
              class="primary"
              disabled={busy}
              onclick={() => gameAction(true)}>{t('gameStop')}</button
            >
          {:else}<button
              class="primary"
              disabled={busy || !desktop || !gaming?.settingAvailable}
              onclick={() => gameAction()}>{t('gameStart')}</button
            >{/if}
        </div>
      {:else if page === 'cleanup'}
        <div class="notice">
          <Icon name="info" />
          <p>{t('cleanupNote')}</p>
        </div>
        <section class="summary-panel panel">
          <span class="large-icon"><Icon name="clean" size={30} /></span>
          <div>
            <span class="eyebrow">{t('cleanup')}</span>
            <h2>{scan ? fmt(totalBytes) : t('firstScan')}</h2>
            {#if scan}<p>{date(scan.createdAt, language)}</p>{/if}
          </div>
          <button class="primary" disabled={busy || !desktop} onclick={scanFiles}
            ><Icon name="search" size={18} />{t(scan ? 'rescan' : 'scan')}</button
          >
        </section>
        {#if scan?.truncated}<div class="notice">
            <Icon name="info" />
            <p>{t('partial')}</p>
          </div>{/if}
        {#if scan}<SelectAll
            ids={scan.categories.filter((c) => c.files > 0).map((c) => c.id)}
            bind:selected={selectedCategories}
            disabled={busy}
            label={t('selectAll')}
          />
          <div class="panel item-list">
            {#each scan.categories as category}<div class="cleanup-row">
                <label class="select-row"
                  ><input
                    type="checkbox"
                    bind:group={selectedCategories}
                    value={category.id}
                    disabled={busy || category.files === 0}
                  /><span class="row-icon"><Icon name="folder" /></span><span class="row-copy"
                    ><strong>{t(category.id)}</strong><small
                      >{category.files} {t('files')} · {t('skipped')}: {category.skipped}</small
                    ></span
                  ><strong class="row-size">{fmt(category.bytes)}</strong></label
                >{#if category.samples.length}<details class="file-samples">
                    <summary>{t('details')}</summary>{#each category.samples as sample}<p
                        class="mono"
                      >
                        {sample}
                      </p>{/each}
                  </details>{/if}
              </div>{/each}
          </div>
          <div class="action-bar">
            <span>{t('selected')}: <strong>{fmt(selectedBytes)}</strong></span><button
              class="primary"
              disabled={busy || !selectedCategories.length}
              onclick={applyCleanup}>{t('clean')}</button
            >
          </div>{/if}
      {:else if page === 'folders'}
        <div class="notice">
          <Icon name="info" />
          <p>{t('folderNote')}</p>
        </div>
        <div class="folder-scope panel">
          <label
            >{t('scanScope')}<select
              aria-label={t('scanScope')}
              bind:value={folderScope}
              disabled={busy}
              onchange={() => {
                folders = null;
                selectedFolders = [];
              }}
            >
              <option value="all">{t('allDrives')}</option><option value="selected"
                >{t('chosenFolder')}</option
              >
            </select></label
          >
          <button class="secondary" disabled={busy || !desktop} onclick={chooseFolder}
            ><Icon name="folder" size={17} />{t('chooseFolder')}</button
          >
          <p class="mono">
            {folderScope === 'all' ? t('allDrives') : folderPath || t('chooseFolder')}
          </p>
        </div>
        <section class="summary-panel panel">
          <span class="large-icon"><Icon name="folder" size={30} /></span>
          <div>
            <span class="eyebrow">{t('folders')}</span>
            <h2>{folders ? `${folders.entries.length} ${t('entries')}` : t('firstScan')}</h2>
            {#if folders}<p>
                {t('searched')}: {folders.visited} · {t('skipped')}: {folders.skipped}
              </p>{/if}
          </div>
          <button
            class="primary"
            disabled={busy || !desktop || (folderScope === 'selected' && !folderPath)}
            onclick={() => scanFolders()}>{t('scan')}</button
          >
        </section>
        {#if folders}<div class="notice">
            <Icon name={folders.complete ? 'check' : 'info'} />
            <div>
              <strong
                >{t(
                  folders.complete ? 'complete' : folderScanning ? 'scanning' : 'scanStopped',
                )}</strong
              >
              <p class="mono">{folders.roots.join(' · ')}</p>
              <p>{t('scanExclusions')}</p>
            </div>
          </div>
          <div class="section-heading">
            <label class="search-field"
              ><Icon name="search" size={17} /><input
                aria-label={t('filter')}
                placeholder={t('filter')}
                bind:value={folderSearch}
              /></label
            ><span>{visibleFolders.length} {t('entries')}</span>
          </div>
          <SelectAll
            ids={visibleFolders.map((f) => f.id)}
            bind:selected={selectedFolders}
            disabled={busy || !folders.complete}
            label={t(folderSearch ? 'selectFiltered' : 'selectAll')}
          />
          {#if visibleFolders.length}<div class="panel item-list folder-list">
              {#each pageFolders as folder}<label class="select-row"
                  ><input
                    type="checkbox"
                    bind:group={selectedFolders}
                    value={folder.id}
                    disabled={busy || !folders.complete}
                  /><span class="row-copy"><strong class="mono">{folder.path}</strong></span></label
                >{/each}
            </div>{:else}<div class="empty panel">
              <Icon name="folder" size={40} />
              <h3>{t('nothing')}</h3>
            </div>{/if}
          <div class="pagination">
            <button
              class="secondary"
              disabled={currentFolderPage === 0}
              onclick={() => (folderPage = currentFolderPage - 1)}>{t('previous')}</button
            >
            <span>{currentFolderPage + 1} / {folderPages}</span>
            <button
              class="secondary"
              disabled={currentFolderPage + 1 >= folderPages}
              onclick={() => (folderPage = currentFolderPage + 1)}>{t('next')}</button
            >
          </div>
          <div class="action-bar">
            <span>{t('selected')}: <strong>{selectedFolders.length}</strong></span><button
              class="primary"
              disabled={busy || !folders.complete || !selectedFolders.length}
              onclick={applyFolders}>{t('deleteFolders')}</button
            >
            {#if folderScanning}<button
                class="secondary"
                disabled={folderStop}
                onclick={() => (folderStop = true)}
                >{t(folderStop ? 'stopping' : 'stopScan')}</button
              >{/if}
          </div>
          <p class="page-note">{t('folderDeleteNote')}</p>{/if}
      {:else if page === 'registry'}
        <div class="notice">
          <Icon name="shield" />
          <p>{t('registryNote')}</p>
        </div>
        <section class="summary-panel panel">
          <span class="large-icon purple"><Icon name="registry" size={30} /></span>
          <div>
            <span class="eyebrow">{t('registry')}</span>
            <h2>{registry ? `${registry.entries.length} ${t('entries')}` : t('firstScan')}</h2>
          </div>
          <button class="primary" disabled={busy || !desktop} onclick={scanRegistry}
            >{t(registry ? 'rescan' : 'scan')}</button
          >
        </section>
        {#if registry?.truncated}<div class="notice">
            <Icon name="info" />
            <p>{t('partial')}</p>
          </div>{/if}{#if registry?.warnings?.length}<details class="notice">
            <summary>{t('details')}</summary>{#each registry.warnings as warning}<p class="mono">
                {warning}
              </p>{/each}
          </details>{/if}
        {#if registry?.entries.length}<SelectAll
            ids={registry.entries.filter((e) => e.canChange).map((e) => e.id)}
            bind:selected={selectedEntries}
            disabled={busy}
            label={t('selectAll')}
          />
          <div class="panel item-list">
            {#each registry.entries as entry}<label class="select-row registry-row"
                ><input
                  type="checkbox"
                  bind:group={selectedEntries}
                  value={entry.id}
                  disabled={busy || !entry.canChange}
                /><span class="row-copy"
                  ><strong>{entry.name}</strong><span>{reason(entry.key, entry.reason)}</span><small
                    class="mono">{entry.key}</small
                  ><small class="mono"
                    >{entry.value === 'Пустой раздел' ? t('reason.empty') : entry.value}</small
                  >{#if !entry.canChange}<small>{t('requiresAdmin')}</small>{/if}</span
                ></label
              >{/each}
          </div>
          <div class="action-bar">
            <span>{t('selected')}: <strong>{selectedEntries.length}</strong></span><button
              class="primary"
              disabled={busy || !selectedEntries.length}
              onclick={applyRegistry}>{t('backupClean')}</button
            >
          </div>{:else}<div class="empty panel">
            <Icon name="registry" size={40} />
            <h3>{t(registry ? 'nothing' : 'firstScan')}</h3>
          </div>{/if}
      {:else if page === 'services'}
        <div class="notice">
          <Icon name="info" />
          <div>
            <p>{t('serviceNote')}</p>
            {#if !system?.isAdmin}<strong>{t('requiresAdmin')}</strong>{/if}
          </div>
        </div>
        <div class="profiles">
          {#each ['minimal', 'privacy', 'no-xbox'] as id}<button
              class="profile panel"
              class:selected={profile === id}
              disabled={busy || !system?.isAdmin}
              onclick={() => selectProfile(id)}
              ><Icon name="sliders" /><strong>{t(id)}</strong></button
            >{/each}
        </div>
        <SelectAll
          ids={services.filter((s) => s.canChange).map((s) => s.id)}
          bind:selected={selectedServices}
          disabled={busy}
          label={t('selectAll')}
          onchange={() => (profile = '')}
        />
        <div class="panel item-list">
          {#each services as service}<label class="select-row service-row"
              ><input
                type="checkbox"
                bind:group={selectedServices}
                value={service.id}
                disabled={busy || !service.canChange}
                onchange={() => (profile = '')}
              /><span class="row-copy"
                ><strong>{service.id}</strong><span>{t(`impact.${service.id}`)}</span><small
                  >{t(
                    service.startMode === 2
                      ? 'automatic'
                      : service.startMode === 3
                        ? 'manualStart'
                        : service.startMode === 4
                          ? 'disabled'
                          : 'unavailable',
                  )}</small
                ></span
              ></label
            >{/each}
        </div>
        <div class="action-bar">
          <span>{t('selected')}: <strong>{selectedServices.length}</strong></span><button
            class="primary"
            disabled={busy || !selectedServices.length}
            onclick={applyServices}>{t('disable')}</button
          >
        </div>
      {:else if page === 'processes'}
        <div class="notice">
          <Icon name="memory" />
          <p>{t('memoryNote')}</p>
        </div>
        <div class="section-heading">
          <label class="search-field"
            ><Icon name="search" size={17} /><input
              aria-label={t('searchApps')}
              placeholder={t('searchApps')}
              bind:value={search}
            /></label
          ><button
            class="secondary"
            disabled={busy || !desktop}
            onclick={() =>
              task(async () => {
                processes = await request('processes.list', {});
              })}><Icon name="refresh" size={16} />{t('refresh')}</button
          >
        </div>
        <div class="panel process-table">
          <div class="table-header">
            <span>{t('app')}</span><span>{t('ram')}</span><span>{t('action')}</span>
          </div>
          {#each visibleProcesses as process}<div class="process-row">
              <div class="process-name">
                <span class="row-icon"><Icon name="activity" /></span><span
                  ><strong>{process.name}</strong><small title={process.title}
                    >{process.title}</small
                  ><small>PID {process.id}</small></span
                >
              </div>
              <strong>{fmt(process.memory)}</strong>
              <div class="process-actions">
                <button
                  class="secondary"
                  disabled={busy}
                  onclick={() => manageProcess(process, true)}>{t('releaseMemory')}</button
                ><button class="text-button" disabled={busy} onclick={() => manageProcess(process)}
                  >{t('close')}</button
                >
              </div>
            </div>{:else}<div class="empty">
              <Icon name="activity" size={40} />
              <h3>{t('nothing')}</h3>
            </div>{/each}
        </div>
      {:else if page === 'history'}
        <div class="notice">
          <Icon name="history" />
          <p>{t('historyNote')}</p>
        </div>
        {#if history.length}<div class="history-list">
            {#each history as entry}<article class="history-card panel">
                <span class="tool-icon"><Icon name="history" /></span>
                <div>
                  <span class="eyebrow">{date(entry.createdAt, language)}</span>
                  <h3>{t(historyKind(entry.kind))}</h3>
                  <p>
                    {t(
                      entry.restored
                        ? 'restored'
                        : entry.canRestore
                          ? 'backupAvailable'
                          : 'noRecovery',
                    )}
                  </p>
                  <details>
                    <summary>{t('details')}</summary>
                    <p>{entry.summary}</p>
                    {#each entry.details as detail}<p class="mono">{detail}</p>{/each}
                  </details>
                </div>
                {#if entry.canRestore}<button
                    class="secondary"
                    disabled={busy}
                    onclick={() => restore(entry.id)}>{t('restore')}</button
                  >{/if}
              </article>{/each}
          </div>{:else}<div class="empty panel">
            <Icon name="history" size={42} />
            <h3>{t('noHistory')}</h3>
          </div>{/if}
      {/if}
    </main>
  </div>
</div>
