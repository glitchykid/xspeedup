import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Agent } from './agent';
import { isMutation, validateRequest } from './validation';
import type { CleanupScan, RegistryScan } from '../shared/contracts';

let window: BrowserWindow | null = null;
let agent: Agent;
let busy = false;
let cleanup: CleanupScan | undefined;
let registry: RegistryScan | undefined;
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
    backgroundColor: '#f3f0e7',
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
    ipcMain.handle('xspeedup:request', async (event, method: unknown, input: unknown) => {
      try {
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== pageUrl
        )
          throw new Error('Недоверенный источник запроса.');
        const request = validateRequest(method, input);
        if (busy) throw new Error('Дождитесь завершения текущей операции.');
        busy = true;
        try {
          if (isMutation(request.method)) {
            const args = request.args as Record<string, unknown>;
            let description = '';
            let heading = 'Подтвердите действие';
            if (request.method === 'cleanup.apply') {
              if (!cleanup || cleanup.id !== args.scanId)
                throw new Error('Сначала выполните анализ файлов.');
              const ids = args.categoryIds as string[];
              const selected = cleanup.categories.filter((c) => ids.includes(c.id));
              if (selected.length !== new Set(ids).size) throw new Error('Некорректный выбор.');
              heading = 'Удалить выбранные файлы безвозвратно?';
              description =
                selected.map((c) => `${c.name}: ${c.files} файлов`).join('\n') +
                '\n\nФайлы не перемещаются в корзину. Резервные копии файлов не создаются. Занятые и изменённые файлы будут пропущены.';
            } else if (request.method === 'registry.apply') {
              if (!registry || registry.id !== args.scanId)
                throw new Error('Сначала выполните анализ реестра.');
              const ids = args.entryIds as string[];
              const selected = registry.entries.filter((e) => ids.includes(e.id));
              if (selected.length !== new Set(ids).size) throw new Error('Некорректный выбор.');
              heading = 'Удалить выбранные записи автозапуска?';
              description =
                selected.map((e) => e.name).join('\n') +
                '\n\nПеред удалением будет сохранена резервная копия. Восстановление доступно в разделе «История».';
            } else if (request.method === 'services.disable') {
              const services = await agent.request('services.list', {});
              const ids = args.serviceIds as string[];
              const selected = services.filter((s) => ids.includes(s.id));
              if (selected.length !== new Set(ids).size || selected.some((s) => !s.canChange))
                throw new Error(
                  'Службы недоступны для изменения. Обновите список и проверьте права администратора.',
                );
              heading = 'Отключить запуск выбранных служб?';
              description =
                selected.map((s) => `${s.name}: ${s.impact}`).join('\n\n') +
                '\n\nНастройки сохранятся в резервную копию. Работающие службы продолжат работу до перезагрузки.';
            } else if (request.method === 'processes.close') {
              const processes = await agent.request('processes.list', {});
              const selected = processes.find(
                (p) => p.id === args.processId && p.startTime === args.startTime,
              );
              if (!selected)
                throw new Error('Приложение уже закрыто или изменилось. Обновите список.');
              heading = `Закрыть ${selected.name}?`;
              description =
                'Будет отправлен обычный запрос на закрытие окна. Приложение может попросить сохранить документы. Принудительное завершение не выполняется.';
            } else {
              const history = await agent.request('history.list', {});
              const selected = history.find((h) => h.id === args.id && h.canRestore);
              if (!selected) throw new Error('Резервная копия недоступна.');
              heading = 'Восстановить исходные настройки?';
              description =
                selected.summary +
                '\n\nЗначения, изменённые другими программами после операции, не будут перезаписаны.';
            }
            const answer = await dialog.showMessageBox(window, {
              type: 'warning',
              title: 'X SpeedUp',
              message: heading,
              detail: description,
              buttons: ['Отмена', 'Подтвердить'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (answer.response !== 1) throw new Error('Действие отменено.');
          }
          const data = await agent.request(request.method, request.args);
          if (request.method === 'cleanup.scan') cleanup = data as CleanupScan;
          if (request.method === 'registry.scan') registry = data as RegistryScan;
          if (request.method === 'cleanup.apply') cleanup = undefined;
          if (request.method === 'registry.apply') registry = undefined;
          return { ok: true, data };
        } finally {
          busy = false;
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Неизвестная ошибка.' };
      }
    });
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
