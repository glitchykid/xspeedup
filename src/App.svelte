<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './lib/Icon.svelte';
  import { bytes, date, startMode } from './lib/format';
  import type {
    ActionResult,
    CleanupScan,
    HistoryItem,
    Method,
    ProcessItem,
    RegistryScan,
    RequestMap,
    ResponseMap,
    ServiceItem,
    SystemInfo,
  } from '../shared/contracts';

  type Page = 'overview' | 'cleanup' | 'registry' | 'services' | 'processes' | 'history';
  const pages: { id: Page; label: string; icon: string; title: string; subtitle: string }[] = [
    {
      id: 'overview',
      label: 'Обзор системы',
      icon: 'grid',
      title: 'Ваш Windows. Под контролем.',
      subtitle: 'Меньше лишнего. Больше места для важного.',
    },
    {
      id: 'cleanup',
      label: 'Очистка файлов',
      icon: 'clean',
      title: 'Место для нового.',
      subtitle: 'Найдите временные файлы, которые больше не нужны.',
    },
    {
      id: 'registry',
      label: 'Реестр',
      icon: 'registry',
      title: 'Порядок в автозапуске.',
      subtitle: 'Проверьте записи реестра, ссылающиеся на удалённые программы.',
    },
    {
      id: 'services',
      label: 'Службы Windows',
      icon: 'sliders',
      title: 'Только нужные службы.',
      subtitle: 'Выберите функции Windows, которыми вы не пользуетесь.',
    },
    {
      id: 'processes',
      label: 'Приложения',
      icon: 'activity',
      title: 'Освободите ресурсы.',
      subtitle: 'Посмотрите, сколько памяти занимают открытые приложения.',
    },
    {
      id: 'history',
      label: 'История',
      icon: 'history',
      title: 'Все изменения на виду.',
      subtitle: 'Просматривайте выполненные действия и восстанавливайте настройки.',
    },
  ];
  let page = $state<Page>('overview');
  let system = $state<SystemInfo | null>(null);
  let scan = $state<CleanupScan | null>(null);
  let registry = $state<RegistryScan | null>(null);
  let services = $state<ServiceItem[]>([]);
  let processes = $state<ProcessItem[]>([]);
  let history = $state<HistoryItem[]>([]);
  let selectedCategories = $state<string[]>([]);
  let selectedEntries = $state<string[]>([]);
  let selectedServices = $state<string[]>([]);
  let busy = $state('');
  let error = $state('');
  let result = $state<ActionResult | null>(null);
  let search = $state('');
  let profile = $state('custom');
  let updatedAt = $state('');
  const desktop = window.desktop;
  const activePage = $derived(pages.find((p) => p.id === page)!);
  const totalBytes = $derived(scan?.categories.reduce((sum, c) => sum + c.bytes, 0) ?? 0);
  const selectedBytes = $derived(
    scan?.categories
      .filter((c) => selectedCategories.includes(c.id))
      .reduce((sum, c) => sum + c.bytes, 0) ?? 0,
  );
  const memoryPercent = $derived(
    system ? Math.round((1 - system.availableMemory / system.totalMemory) * 100) : 0,
  );
  const drivePercent = $derived(
    system ? Math.round((1 - system.driveFree / system.driveTotal) * 100) : 0,
  );
  const visibleProcesses = $derived(
    processes.filter((p) => `${p.name} ${p.title}`.toLowerCase().includes(search.toLowerCase())),
  );

  async function request<M extends Method>(
    method: M,
    args: RequestMap[M],
  ): Promise<ResponseMap[M]> {
    if (!desktop) throw new Error('Откройте настольное приложение X SpeedUp для работы с Windows.');
    return desktop.request(method, args);
  }
  async function task(label: string, action: () => Promise<void>) {
    if (busy) return;
    busy = label;
    error = '';
    result = null;
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = '';
    }
  }
  async function refreshSystem() {
    system = await request('system', {});
    updatedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  async function navigate(next: Page) {
    if (busy) return;
    page = next;
    error = '';
    result = null;
    if (!desktop) return;
    if (next === 'services')
      await task('Получаем службы…', async () => {
        services = await request('services.list', {});
        selectedServices = [];
        profile = 'custom';
      });
    if (next === 'processes')
      await task('Получаем приложения…', async () => {
        processes = await request('processes.list', {});
      });
    if (next === 'history')
      await task('Читаем историю…', async () => {
        history = await request('history.list', {});
      });
  }
  async function scanFiles() {
    await task('Анализируем файлы…', async () => {
      scan = await request('cleanup.scan', {});
      selectedCategories = [];
      page = 'cleanup';
    });
  }
  async function scanRegistry() {
    await task('Проверяем автозапуск…', async () => {
      registry = await request('registry.scan', {});
      selectedEntries = [];
    });
  }
  async function applyCleanup() {
    if (!scan) return;
    await task('Очищаем выбранные файлы…', async () => {
      result = await request('cleanup.apply', {
        scanId: scan!.id,
        categoryIds: selectedCategories,
      });
      scan = null;
      selectedCategories = [];
      await refreshSystem();
    });
  }
  async function applyRegistry() {
    if (!registry) return;
    await task('Сохраняем копию и очищаем реестр…', async () => {
      result = await request('registry.apply', { scanId: registry!.id, entryIds: selectedEntries });
      registry = null;
      selectedEntries = [];
    });
  }
  async function applyServices() {
    await task('Сохраняем настройки служб…', async () => {
      result = await request('services.disable', { serviceIds: selectedServices });
      services = await request('services.list', {});
      selectedServices = [];
      profile = 'custom';
    });
  }
  function selectProfile(id: string) {
    profile = id;
    selectedServices = services
      .filter((s) => s.canChange && s.profiles.includes(id))
      .map((s) => s.id);
  }
  async function closeProcess(process: ProcessItem) {
    await task('Отправляем запрос на закрытие…', async () => {
      result = await request('processes.close', {
        processId: process.id,
        startTime: process.startTime,
      });
      processes = await request('processes.list', {});
    });
  }
  async function restore(id: string) {
    await task('Восстанавливаем настройки…', async () => {
      result = await request('history.restore', { id });
      history = await request('history.list', {});
    });
  }
  onMount(() => {
    if (desktop) void task('Подключаемся к Windows…', refreshSystem);
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
      aria-label="X SpeedUp — обзор"
    >
      <span class="brand-mark"><Icon name="bolt" size={25} /></span><span
        >X SpeedUp<small>WINDOWS UTILITY</small></span
      >
    </a>
    <span class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
    <nav aria-label="Разделы приложения">
      {#each pages as item}
        <button
          class:active={page === item.id}
          class:history-nav={item.id === 'history'}
          disabled={!!busy}
          onclick={() => navigate(item.id)}
          aria-current={page === item.id ? 'page' : undefined}
        >
          <Icon name={item.icon} size={19} /><span>{item.label}</span>{#if page === item.id}<i
              class="nav-dot"
            ></i>{/if}
        </button>
      {/each}
    </nav>
    <div class="sidebar-bottom">
      <div class="local-note">
        <Icon name="shield" size={22} /><strong>Локально. Прозрачно.</strong>
        <p>Данные остаются<br />на вашем компьютере.</p>
      </div>
      <div class="version"><span class="status-dot"></span> X SpeedUp <span>v0.1.0</span></div>
    </div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <div>
        <span class="breadcrumb">Рабочее пространство</span><span class="slash">/</span
        >{activePage.label}
      </div>
      <span class="connection"
        ><span class:offline={!system} class="status-dot"></span>{system
          ? 'Подключено к Windows'
          : desktop
            ? 'Подключение…'
            : 'Предпросмотр интерфейса'}</span
      >
    </header>
    <main>
      <div class="page-heading">
        <div>
          <div class="eyebrow">
            {page === 'overview' ? 'ОБЗОР СИСТЕМЫ' : 'X SPEEDUP / ОБСЛУЖИВАНИЕ'}
          </div>
          <h1>{activePage.title}</h1>
          <p>{activePage.subtitle}</p>
        </div>
        <span class="mode-badge"
          ><Icon name="shield" size={15} />{system?.isAdmin
            ? 'Администратор'
            : 'Ручной контроль'}</span
        >
      </div>

      {#if !desktop}<div class="notice">
          <Icon name="info" />
          <div>
            <strong>Предпросмотр интерфейса</strong>
            <p>
              Запустите настольное приложение, чтобы увидеть данные компьютера и использовать
              инструменты.
            </p>
          </div>
        </div>{/if}
      {#if error}<div class="notice error" role="alert">
          <Icon name="info" />
          <div>{error}</div>
          <button class="icon-button" aria-label="Закрыть сообщение" onclick={() => (error = '')}
            ><Icon name="close" size={16} /></button
          >
        </div>{/if}
      {#if result}<div class="notice success" role="status">
          <Icon name="check" />
          <div>
            <strong>{result.message}</strong>{#if result.details?.length}<details>
                <summary>Подробности ({result.details.length})</summary
                >{#each result.details as detail}<p class="mono">{detail}</p>{/each}
              </details>{/if}
          </div>
        </div>{/if}
      {#if busy}<div class="working" role="status">
          <span class="spinner"></span>{busy}<span>Не закрывайте приложение</span>
        </div>{/if}

      {#if page === 'overview'}
        <section class="hero panel">
          <div class="hero-copy">
            <span class="pill"><span class="status-dot"></span>НАЧНИТЕ С АНАЛИЗА</span>
            <h2>Дайте компьютеру<br /><span>больше свободы.</span></h2>
            <p>
              Проверьте временные файлы и выберите,<br class="wide-only" /> что удалить. Каждый шаг —
              под вашим контролем.
            </p>
            <button class="primary" onclick={scanFiles} disabled={!!busy || !desktop}
              ><Icon name="search" size={19} />Анализировать систему<Icon
                name="arrow"
                size={18}
              /></button
            ><span class="hero-footnote"
              ><Icon name="shield" size={13} />Анализ ничего не изменяет</span
            >
          </div>
          <div class="hero-visual" aria-hidden="true">
            <div class="orbit orbit-outer"></div>
            <div class="orbit orbit-inner"></div>
            <div class="orbit-node node-one"><Icon name="clean" /></div>
            <div class="orbit-node node-two"><Icon name="registry" /></div>
            <div class="orbit-node node-three"><Icon name="sliders" /></div>
            <div class="core"><Icon name="bolt" size={72} /></div>
            <div class="visual-caption">МЕНЬШЕ ЛИШНЕГО<span>Больше возможностей</span></div>
          </div>
        </section>
        <div class="section-heading">
          <h2>Состояние компьютера</h2>
          <button
            class="text-button"
            disabled={!!busy || !desktop}
            onclick={() => task('Обновляем данные…', refreshSystem)}
            ><Icon name="refresh" size={14} />{updatedAt
              ? `Обновлено в ${updatedAt}`
              : 'Обновить'}</button
          >
        </div>
        <div class="metrics">
          <article class="metric panel">
            <div class="metric-label"><span>Системный диск</span><Icon name="disk" /></div>
            <div class="metric-value">
              {system ? bytes(system.driveFree) : '—'}<small>свободно</small>
            </div>
            <div class="bar"><span style:width={`${drivePercent}%`}></span></div>
            <div class="metric-foot">
              {system
                ? `${bytes(system.driveTotal - system.driveFree)} занято из ${bytes(system.driveTotal)}`
                : 'Ожидание данных Windows'}
            </div>
          </article>
          <article class="metric panel">
            <div class="metric-label"><span>Оперативная память</span><Icon name="memory" /></div>
            <div class="metric-value">
              {system ? `${memoryPercent}%` : '—'}<small>используется</small>
            </div>
            <div class="bar purple"><span style:width={`${memoryPercent}%`}></span></div>
            <div class="metric-foot">
              {system
                ? `${bytes(system.availableMemory)} доступно из ${bytes(system.totalMemory)}`
                : 'Ожидание данных Windows'}
            </div>
          </article>
          <article class="metric panel">
            <div class="metric-label"><span>Время работы</span><Icon name="clock" /></div>
            <div class="metric-value">
              {system ? Math.floor(system.uptimeSeconds / 3600) : '—'}<small>часов</small>
            </div>
            <div class="uptime-detail">
              <span class="status-dot"></span>{system
                ? `${system.processorCount} логических процессоров`
                : 'Ожидание данных'}
            </div>
            <div class="metric-foot">С последней загрузки Windows</div>
          </article>
        </div>
        <div class="section-heading tools-heading">
          <h2>Инструменты для порядка</h2>
          <span>Вы решаете, что изменить</span>
        </div>
        <div class="tool-grid">
          {#each [{ id: 'cleanup' as Page, icon: 'clean', title: 'Очистка файлов', text: 'Временные файлы, кэш и старые отчёты об ошибках.', tag: 'Больше места', color: 'mint' }, { id: 'registry' as Page, icon: 'registry', title: 'Реестр', text: 'Устаревшие записи автозапуска с резервной копией.', tag: 'Можно восстановить', color: 'purple' }, { id: 'services' as Page, icon: 'sliders', title: 'Службы Windows', text: 'Настройте фоновые функции под свои задачи.', tag: 'Готовые профили', color: 'blue' }] as tool}<button
              class="tool-card panel"
              disabled={!!busy}
              onclick={() => navigate(tool.id)}
              ><span class="tool-icon {tool.color}"><Icon name={tool.icon} size={22} /></span><Icon
                name="arrow"
                size={17}
              />
              <h3>{tool.title}</h3>
              <p>{tool.text}</p>
              <span class="tool-tag">{tool.tag}</span></button
            >{/each}
        </div>
        <footer class="system-footer">
          <Icon name="windows" size={16} /><span>{system?.os ?? 'Windows 10 / 11'}</span><span
            class="footer-dot">·</span
          ><span>{system?.machine ?? 'Локальное приложение'}</span><span class="footer-right"
            >Без фоновой оптимизации и скрытых действий</span
          >
        </footer>
      {:else if page === 'cleanup'}
        <section class="summary-panel panel">
          <span class="large-icon mint"><Icon name="clean" size={30} /></span>
          <div>
            <span class="eyebrow">{scan ? 'ДОСТУПНО ДЛЯ ОЧИСТКИ' : 'СНАЧАЛА ПРОВЕРИМ ФАЙЛЫ'}</span>
            <h2>{scan ? bytes(totalBytes) : 'Найдём то, что можно удалить'}</h2>
            <p>
              {scan
                ? `Анализ от ${date(scan.createdAt)}. Выберите категории ниже.`
                : 'Анализируются только временные папки текущего пользователя.'}
            </p>
          </div>
          <button class="primary" disabled={!!busy || !desktop} onclick={scanFiles}
            ><Icon name={scan ? 'refresh' : 'search'} size={18} />{scan
              ? 'Повторить анализ'
              : 'Анализировать файлы'}</button
          >
        </section>
        {#if scan?.truncated}<div class="notice">
            <Icon name="info" />
            <p>
              Достигнут лимит анализа. Показана часть файлов; после очистки можно повторить
              проверку.
            </p>
          </div>{/if}
        <div class="section-heading">
          <h2>Категории очистки</h2>
          <span>Файлы удаляются безвозвратно</span>
        </div>
        {#if scan}<div class="panel item-list">
            {#each scan.categories as category}<div class="cleanup-row">
                <label class="select-row"
                  ><input
                    type="checkbox"
                    bind:group={selectedCategories}
                    value={category.id}
                    disabled={!!busy || category.files === 0}
                  /><span class="row-icon"
                    ><Icon
                      name={category.id === 'temp'
                        ? 'folder'
                        : category.id === 'shader'
                          ? 'cpu'
                          : 'activity'}
                      size={23}
                    /></span
                  ><span class="row-copy"
                    ><strong>{category.name}</strong><span>{category.description}</span><small
                      >{category.files.toLocaleString('ru-RU')} файлов · недоступных объектов: {category.skipped}</small
                    ></span
                  ><strong class="row-size">{bytes(category.bytes)}</strong></label
                >{#if category.samples.length}<details class="file-samples">
                    <summary>Примеры найденных файлов</summary>{#each category.samples as file}<p>
                        {file}
                      </p>{/each}
                  </details>{/if}
              </div>{/each}
          </div>
          <div class="action-bar">
            <span>Выбрано: <strong>{bytes(selectedBytes)}</strong></span><button
              class="primary"
              disabled={!!busy || selectedCategories.length === 0}
              onclick={applyCleanup}><Icon name="clean" size={18} />Очистить выбранное</button
            >
          </div>
        {:else}<div class="empty panel">
            <Icon name="folder" size={42} />
            <h3>Список появится после анализа</h3>
            <p>
              Temp и кэш DirectX — старше 7 дней, дампы сбоев — старше 14 дней.<br />Занятые файлы и
              ссылки на другие папки будут пропущены.
            </p>
          </div>{/if}
      {:else if page === 'registry'}
        <div class="notice">
          <Icon name="shield" />
          <div>
            <strong>Точная проверка автозапуска</strong>
            <p>
              Проверяется только раздел Run текущего пользователя. Неоднозначные команды и сетевые
              пути пропускаются. Очистка реестра сама по себе не гарантирует ускорения Windows.
            </p>
          </div>
        </div>
        <section class="summary-panel panel">
          <span class="large-icon purple"><Icon name="registry" size={30} /></span>
          <div>
            <span class="eyebrow">ЗАПИСИ С ОТСУТСТВУЮЩИМИ ПРОГРАММАМИ</span>
            <h2>{registry ? `${registry.entries.length} записей` : 'Проверка реестра'}</h2>
            <p>Перед удалением создаётся резервная копия значений.</p>
          </div>
          <button class="primary" disabled={!!busy || !desktop} onclick={scanRegistry}
            ><Icon name="search" size={18} />{registry
              ? 'Проверить снова'
              : 'Проверить реестр'}</button
          >
        </section>
        {#if registry?.entries.length}<div class="panel item-list">
            {#each registry.entries as entry}<label class="select-row registry-row"
                ><input
                  type="checkbox"
                  bind:group={selectedEntries}
                  value={entry.id}
                  disabled={!!busy}
                /><span class="row-copy"
                  ><strong>{entry.name}</strong><span>{entry.reason}</span><small class="mono"
                    >{entry.key}</small
                  ><small class="mono">{entry.value}</small></span
                ></label
              >{/each}
          </div>
          <div class="action-bar">
            <span>Выбрано: <strong>{selectedEntries.length}</strong></span><button
              class="primary"
              disabled={!!busy || !selectedEntries.length}
              onclick={applyRegistry}>Создать копию и очистить</button
            >
          </div>{:else}<div class="empty panel">
            <Icon name={registry ? 'check' : 'registry'} size={42} />
            <h3>{registry ? 'Устаревшие записи не найдены' : 'Сначала проверим записи'}</h3>
            <p>
              {registry
                ? 'В проверяемом разделе нет записей, подходящих под условия очистки.'
                : 'Существующие программы и системные разделы останутся на месте.'}
            </p>
          </div>{/if}
      {:else if page === 'services'}
        {#if !system?.isAdmin}<div class="notice">
            <Icon name="info" />
            <div>
              <strong>Для изменения служб нужны права администратора</strong>
              <p>
                Закройте приложение и выберите «Запуск от имени администратора». Список доступен для
                просмотра.
              </p>
            </div>
          </div>{/if}
        <div class="section-heading">
          <h2>Профили</h2>
          <span>Профиль только выбирает службы</span>
        </div>
        <div class="profiles">
          {#each [{ id: 'minimal', title: 'Без карт и факса', text: 'Если эти функции не используются', icon: 'sliders' }, { id: 'privacy', title: 'Меньше телеметрии', text: 'Для личного, неуправляемого ПК', icon: 'shield' }, { id: 'no-xbox', title: 'Без Xbox', text: 'Если вы не используете Xbox Live', icon: 'cpu' }] as option}<button
              class="profile panel"
              class:selected={profile === option.id}
              disabled={!!busy || !system?.isAdmin}
              onclick={() => selectProfile(option.id)}
              ><Icon name={option.icon} size={24} /><strong>{option.title}</strong><span
                >{option.text}</span
              ></button
            >{/each}
        </div>
        <div class="section-heading">
          <h2>Службы и последствия отключения</h2>
          <span>{selectedServices.length} выбрано</span>
        </div>
        <div class="panel item-list">
          {#each services as service}<label class="select-row service-row"
              ><input
                type="checkbox"
                bind:group={selectedServices}
                value={service.id}
                disabled={!!busy || !service.canChange}
                onchange={() => (profile = 'custom')}
              /><span class="row-copy"
                ><strong>{service.name}<code>{service.id}</code></strong><span
                  >{service.impact}</span
                ><small
                  >{service.installed
                    ? `${service.status} · Запуск: ${startMode(service.startMode)}`
                    : 'Не установлена в этой версии Windows'}</small
                ></span
              ><span class:disabled-badge={service.startMode === 4} class="small-badge"
                >{service.startMode === 4
                  ? 'Отключена'
                  : service.installed
                    ? 'Доступна'
                    : 'Нет'}</span
              ></label
            >{/each}
        </div>
        <div class="action-bar">
          <span>Настройки сохранятся. Применение — после перезагрузки.</span><button
            class="primary"
            disabled={!!busy || !selectedServices.length}
            onclick={applyServices}>Отключить выбранные</button
          >
        </div>
      {:else if page === 'processes'}
        <div class="notice">
          <Icon name="info" />
          <p>
            Показаны приложения с открытыми окнами в текущем сеансе. Закрытие обычное: приложение
            сможет предложить сохранить документы. Системные процессы исключены.
          </p>
        </div>
        <div class="section-heading">
          <label class="search-field"
            ><Icon name="search" size={17} /><input
              aria-label="Поиск приложений"
              placeholder="Найти приложение…"
              bind:value={search}
            /></label
          ><button
            class="secondary"
            disabled={!!busy || !desktop}
            onclick={() =>
              task('Обновляем список…', async () => {
                processes = await request('processes.list', {});
              })}><Icon name="refresh" size={16} />Обновить</button
          >
        </div>
        <div class="panel process-table">
          <div class="table-header">
            <span>ПРИЛОЖЕНИЕ</span><span>ПАМЯТЬ</span><span>ДЕЙСТВИЕ</span>
          </div>
          {#each visibleProcesses as process}<div class="process-row">
              <div class="process-name">
                <span class="row-icon"><Icon name="activity" size={20} /></span><span
                  ><strong>{process.name}</strong><small title={process.title}
                    >{process.title}</small
                  ><small>PID {process.id}</small></span
                >
              </div>
              <strong>{bytes(process.memory)}</strong><button
                class="secondary"
                disabled={!!busy}
                onclick={() => closeProcess(process)}>Закрыть</button
              >
            </div>{:else}<div class="empty">
              <Icon name="activity" size={40} />
              <h3>Приложения не найдены</h3>
              <p>Нет подходящих открытых окон или совпадений с поиском.</p>
            </div>{/each}
        </div>
      {:else if page === 'history'}
        <div class="notice">
          <Icon name="history" />
          <p>
            Копии хранятся локально. Можно восстановить удалённые записи реестра и режимы запуска
            служб. Удалённые файлы восстановить нельзя.
          </p>
        </div>
        {#if history.length}<div class="history-list">
            {#each history as entry}<article class="history-card panel">
                <span class="tool-icon {entry.kind === 'cleanup' ? 'mint' : 'purple'}"
                  ><Icon
                    name={entry.kind === 'cleanup'
                      ? 'clean'
                      : entry.kind === 'registry'
                        ? 'registry'
                        : 'sliders'}
                  /></span
                >
                <div>
                  <span class="eyebrow">{date(entry.createdAt)}</span>
                  <h3>{entry.summary}</h3>
                  <p>
                    {entry.restored
                      ? 'Настройки восстановлены'
                      : entry.canRestore
                        ? 'Резервная копия доступна'
                        : 'Восстановление недоступно'}
                  </p>
                  {#if entry.details.length}<details>
                      <summary>Подробности</summary>{#each entry.details as detail}<p class="mono">
                          {detail}
                        </p>{/each}
                    </details>{/if}
                </div>
                {#if entry.canRestore}<button
                    class="secondary"
                    disabled={!!busy}
                    onclick={() => restore(entry.id)}
                    ><Icon name="history" size={16} />Восстановить</button
                  >{:else if entry.restored}<span class="small-badge">Восстановлено</span>{/if}
              </article>{/each}
          </div>{:else}<div class="empty panel">
            <Icon name="history" size={44} />
            <h3>Всё начинается с чистого листа</h3>
            <p>
              Выполненные очистки и изменения настроек появятся здесь.<br />Обычный анализ не
              создаёт записей.
            </p>
            <button class="secondary" disabled={!!busy} onclick={() => navigate('overview')}
              >Перейти к обзору<Icon name="arrow" size={16} /></button
            >
          </div>{/if}
      {/if}
    </main>
  </div>
</div>
