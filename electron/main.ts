import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Agent } from './agent';
import { isMutation, validateRequest } from './validation';
import type { CleanupScan, RegistryScan, FolderScan } from '../shared/contracts';
import { createTranslator, validLocale } from '../shared/i18n';

let window: BrowserWindow | null = null;
let agent: Agent;
let busy = false;
let cleanup: CleanupScan | undefined;
let registry: RegistryScan | undefined;
let folders: FolderScan | undefined;
const development = !app.isPackaged && process.env.XSPEEDUP_DEV === '1';
const pagePath = path.join(__dirname, '../dist/index.html');
const pageUrl = development ? 'http://127.0.0.1:5173/' : pathToFileURL(pagePath).href;
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

async function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1020,
    minHeight: 720,
    title: 'X SpeedUp',
    icon: path.join(__dirname, '../dist/images/app-icon.png'),
    backgroundColor: '#eef3fc',
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
    if (busy) event.preventDefault();
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
          if (
            !window ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== pageUrl
          )
            throw new Error('Недоверенный источник запроса.');
          const request = validateRequest(method, input);
          const t = createTranslator(validLocale(locale));
          if (busy) throw new Error('Дождитесь завершения текущей операции.');
          busy = true;
          try {
            if (isMutation(request.method)) {
              const args = request.args as Record<string, unknown>;
              let description = '';
              let heading = t('confirmTitle');
              if (request.method === 'cleanup.apply') {
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
                const ids = args.entryIds as string[];
                const selected = registry.entries.filter((e) => ids.includes(e.id));
                if (selected.length !== new Set(ids).size || selected.some((e) => !e.canChange))
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
                const ids = args.entryIds as string[];
                const selected = folders.entries.filter((e) => ids.includes(e.id));
                if (selected.length !== new Set(ids).size)
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
              const answer = await dialog.showMessageBox(window, {
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
            const data = await agent.request(request.method, request.args);
            if (request.method === 'cleanup.scan') cleanup = data as CleanupScan;
            if (request.method === 'registry.scan') registry = data as RegistryScan;
            if (request.method === 'folders.scan' || request.method === 'folders.continue')
              folders = data as FolderScan;
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
  if (busy) {
    event.preventDefault();
    return;
  }
  agent?.stop();
});
