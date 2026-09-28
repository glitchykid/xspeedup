import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Agent } from './agent';
import { isMutation, validateRequest } from './validation';
import type { CleanupScan, RegistryScan, FolderScan, BenchOptions } from '../shared/contracts';
import { createTranslator, validLocale } from '../shared/i18n';

let window: BrowserWindow | null = null;
let agent: Agent;
let busy = false;
let benchmark: BrowserWindow | null = null;
let benchmarkActive = false;
let benchmarkConfig: { options: BenchOptions; locale: string } | null = null;
let cleanup: CleanupScan | undefined;
let registry: RegistryScan | undefined;
let folders: FolderScan | undefined;
let selectedFolder: string | undefined;
const development = !app.isPackaged && process.env.XSPEEDUP_DEV === '1';
const pagePath = path.join(__dirname, '../dist/index.html');
const pageUrl = development ? 'http://127.0.0.1:5173/' : pathToFileURL(pagePath).href;
const benchmarkUrl = pageUrl + '#benchmark';
function requestBenchmarkStop() {
  benchmark?.webContents.send('xspeedup:bench-stop');
}
async function openBenchmark(options: BenchOptions, locale: string) {
  if (!window || benchmark) throw new Error('Benchmark window already open.');
  benchmarkConfig = { options, locale };
  benchmarkActive = true;
  const child = new BrowserWindow({
    parent: window,
    modal: true,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: '#14191c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  benchmark = child;
  child.once('ready-to-show', () => {
    child.show();
    child.setFullScreen(true);
  });
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on('will-navigate', (event) => event.preventDefault());
  child.webContents.on('will-attach-webview', (event) => event.preventDefault());
  child.on('close', (event) => {
    if (benchmarkActive) {
      event.preventDefault();
      requestBenchmarkStop();
    }
  });
  child.on('closed', () => {
    benchmark = null;
    benchmarkActive = false;
    benchmarkConfig = null;
    window?.focus();
  });
  // A lost renderer cannot acknowledge completion; the independent native watchdog restores offsets.
  child.webContents.on('render-process-gone', () => {
    benchmarkActive = false;
    child.destroy();
  });
  try {
    await child.loadURL(benchmarkUrl);
  } catch (error) {
    benchmarkActive = false;
    child.destroy();
    throw error;
  }
}
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

async function createWindow() {
  window = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 1020,
    minHeight: 720,
    title: 'X SpeedUp',
    icon: path.join(__dirname, '../dist/images/app-icon.png'),
    backgroundColor: '#1d2428',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (busy || benchmarkActive) {
      event.preventDefault();
      if (benchmarkActive) requestBenchmarkStop();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  await window.loadURL(pageUrl);
}

app
  .whenReady()
  .then(async () => {
    if (!singleInstance) return;
    session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const published = path.join(app.getAppPath(), 'artifacts/agent/XSpeedUp.Agent.exe');
    const usePublished = !development && existsSync(published);
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'agent/XSpeedUp.Agent.exe')
      : usePublished
        ? published
        : path.join(
            app.getAppPath(),
            'native/XSpeedUp.Agent/bin/Debug/net10.0-windows/XSpeedUp.Agent.exe',
          );
    // A locally installed SDK is only needed for the development, framework-dependent agent.
    const localRuntime = path.join(app.getAppPath(), '.tools/dotnet');
    if (!app.isPackaged && !usePublished && existsSync(localRuntime))
      process.env.DOTNET_ROOT = localRuntime;
    agent = new Agent(executable);
    ipcMain.handle(
      'xspeedup:request',
      async (event, method: unknown, input: unknown, locale: unknown) => {
        try {
          const fromBench = !!benchmark && event.sender === benchmark.webContents;
          const source = fromBench ? benchmark : window;
          if (
            !window ||
            !source ||
            event.sender !== source.webContents ||
            event.senderFrame !== source.webContents.mainFrame ||
            event.senderFrame.url !== (fromBench ? benchmarkUrl : pageUrl)
          )
            throw new Error('Недоверенный источник запроса.');
          const request = validateRequest(method, input);
          const benchOnly = [
            'bench.config',
            'bench.complete',
            'bench.close',
            'tuning.start',
            'tuning.heartbeat',
            'tuning.advance',
            'tuning.finish',
          ];
          if (
            (fromBench && ![...benchOnly, 'tuning.status'].includes(request.method)) ||
            (!fromBench && benchOnly.includes(request.method))
          )
            throw new Error('Operation unavailable in this window.');
          if (request.method === 'bench.config') return { ok: true, data: benchmarkConfig };
          if (request.method === 'bench.complete') {
            benchmarkActive = false;
            return { ok: true, data: null };
          }
          if (request.method === 'bench.close') {
            if (benchmarkActive) requestBenchmarkStop();
            else setTimeout(() => benchmark?.close(), 50);
            return { ok: true, data: null };
          }
          if (!fromBench && benchmark) throw new Error('Close the benchmark window first.');
          const t = createTranslator(validLocale(locale));
          if (busy) throw new Error('Дождитесь завершения текущей операции.');
          busy = true;
          try {
            if (request.method === 'bench.open') {
              await openBenchmark(request.args as BenchOptions, validLocale(locale));
              return { ok: true, data: null };
            }
            if (request.method === 'gaming.settings') {
              await shell.openExternal('ms-settings:gaming-gamemode');
              return { ok: true, data: null };
            }
            if (request.method === 'folders.choose') {
              const choice = await dialog.showOpenDialog(window, {
                title: t('chooseFolder'),
                properties: ['openDirectory', 'dontAddToRecent'],
                defaultPath: selectedFolder,
              });
              if (choice.canceled || !choice.filePaths[0]) return { ok: true, data: null };
              selectedFolder = choice.filePaths[0];
              return { ok: true, data: selectedFolder };
            }
            if (isMutation(request.method)) {
              const args = request.args as Record<string, unknown>;
              let description = '';
              let heading = t('confirmTitle');
              if (request.method === 'tuning.start') {
                const capability = await agent.request('tuning.status', {});
                const gpu = capability.devices.find((d) => d.id === args.deviceId && d.canTune);
                if (!gpu) throw new Error('Драйвер не подтвердил возможность подбора частот.');
                heading = t('autoTune');
                description =
                  gpu.name +
                  '\n\n' +
                  t('stepSeconds') +
                  ': ' +
                  args.stepSeconds +
                  ' s\n\n' +
                  t('tuneNote');
              } else if (request.method === 'gaming.start') {
                const profile =
                  request.args as import('../shared/contracts').RequestMap['gaming.start'];
                const apps = await agent.request('processes.list', {});
                const selected = profile.processes.map((p) =>
                  apps.find((a) => a.id === p.id && a.startTime === p.startTime),
                );
                if (selected.some((p) => !p))
                  throw new Error('Список приложений изменился. Обновите его.');
                heading = t('gameStart');
                description =
                  t('gameNote') +
                  '\n\n' +
                  t('gameWindows') +
                  '\n\n' +
                  profile.serviceIds.map((id) => `${id}: ${t(`impact.${id}`)}`).join('\n') +
                  '\n\n' +
                  selected.map((p) => `${t('close')}: ${p!.name} (${p!.id})`).join('\n');
              } else if (request.method === 'gaming.stop') {
                const status = await agent.request('gaming.status', {});
                if (!status.sessionId) throw new Error('Игровой режим не активен.');
                heading = t('gameStop');
                description = t('gameRestore');
              } else if (request.method === 'cleanup.apply') {
                if (!cleanup || cleanup.id !== args.scanId)
                  throw new Error('Сначала выполните анализ файлов.');
                const ids = args.categoryIds as string[];
                const selected = cleanup.categories.filter((c) => ids.includes(c.id));
                if (selected.length !== new Set(ids).size) throw new Error('Некорректный выбор.');
                heading = t('clean');
                description =
                  selected.map((c) => `${t(c.id)}: ${c.files} ${t('files')}`).join('\n') +
                  '\n\n' +
                  t('cleanupNote');
              } else if (request.method === 'registry.apply') {
                if (!registry || registry.id !== args.scanId)
                  throw new Error('Сначала выполните анализ реестра.');
                const ids =
                  args.entryIds === 'all'
                    ? registry.entries.filter((e) => e.canChange).map((e) => e.id)
                    : (args.entryIds as string[]);
                const idSet = new Set(ids);
                const selected = registry.entries.filter((e) => idSet.has(e.id));
                if (
                  !selected.length ||
                  selected.length !== idSet.size ||
                  selected.some((e) => !e.canChange)
                )
                  throw new Error('Некорректный выбор или недостаточно прав.');
                heading = t('backupClean');
                description =
                  selected
                    .slice(0, 15)
                    .map((e) => `${e.name}: ${e.key}`)
                    .join('\n') +
                  `\n${t('selected')}: ${selected.length}.\n\n` +
                  t('registryNote');
              } else if (request.method === 'services.disable') {
                const services = await agent.request('services.list', {});
                const ids = args.serviceIds as string[];
                const selected = services.filter((s) => ids.includes(s.id));
                if (selected.length !== new Set(ids).size || selected.some((s) => !s.canChange))
                  throw new Error(
                    'Службы недоступны для изменения. Обновите список и проверьте права администратора.',
                  );
                heading = t('disable');
                description =
                  selected.map((s) => `${s.id}: ${t(`impact.${s.id}`)}`).join('\n\n') +
                  '\n\n' +
                  t('serviceNote');
              } else if (request.method === 'folders.apply') {
                if (!folders || folders.id !== args.scanId)
                  throw new Error('Сначала выполните поиск папок.');
                if (!folders.complete) throw new Error('Дождитесь полного сканирования.');
                const ids =
                  args.entryIds === 'all'
                    ? folders.entries.map((e) => e.id)
                    : (args.entryIds as string[]);
                const idSet = new Set(ids);
                const selected = folders.entries.filter((e) => idSet.has(e.id));
                if (!selected.length || selected.length !== idSet.size)
                  throw new Error('Некорректный выбор папок.');
                heading = t('deleteFolders');
                description =
                  selected
                    .slice(0, 20)
                    .map((e) => e.path)
                    .join('\n') +
                  `\n${t('selected')}: ${selected.length}.\n\n` +
                  t('folderDeleteNote');
              } else if (
                request.method === 'processes.close' ||
                request.method === 'memory.release'
              ) {
                const processes = await agent.request('processes.list', {});
                const selected = processes.find(
                  (p) => p.id === args.processId && p.startTime === args.startTime,
                );
                if (!selected)
                  throw new Error('Приложение уже закрыто или изменилось. Обновите список.');
                const release = request.method === 'memory.release';
                heading = `${t(release ? 'releaseMemory' : 'close')}: ${selected.name}?`;
                description = t(release ? 'memoryNote' : 'closeNote');
              } else {
                const history = await agent.request('history.list', {});
                const selected = history.find((h) => h.id === args.id && h.canRestore);
                if (!selected) throw new Error('Резервная копия недоступна.');
                heading = t('restore');
                description = t('restoreNote');
              }
              const answer = await dialog.showMessageBox(source, {
                type: 'warning',
                title: 'X SpeedUp',
                message: heading,
                detail: description,
                buttons: [t('cancel'), t('confirm')],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              if (answer.response !== 1) throw new Error(t('canceled'));
            }
            const folderScope =
              request.method === 'folders.scan' ? (request.args as { scope: string }).scope : null;
            if (folderScope === 'selected' && !selectedFolder) throw new Error(t('chooseFolder'));
            const data = await agent.request(
              request.method,
              request.args,
              folderScope === 'selected' ? selectedFolder : undefined,
            );
            if (request.method === 'cleanup.scan') cleanup = data as CleanupScan;
            if (request.method === 'registry.scan') registry = data as RegistryScan;
            if (request.method === 'folders.scan' || request.method === 'folders.cancel')
              folders = data as FolderScan;
            if (request.method === 'folders.continue') {
              const batch = data as FolderScan;
              folders = { ...batch, entries: [...(folders?.entries ?? []), ...batch.entries] };
            }
            if (request.method === 'folders.apply') folders = undefined;
            if (request.method === 'cleanup.apply') cleanup = undefined;
            if (request.method === 'registry.apply') registry = undefined;
            return { ok: true, data };
          } finally {
            busy = false;
          }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Неизвестная ошибка.',
          };
        }
      },
    );
    await createWindow();
  })
  .catch((error) => {
    dialog.showErrorBox('X SpeedUp', String(error));
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (busy || benchmarkActive) {
    event.preventDefault();
    if (benchmarkActive) requestBenchmarkStop();
    return;
  }
  agent?.stop();
});
