import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/screenshots', { recursive: true });
const environment = {
  ...process.env,
  XSPEEDUP_DEV: '',
  DOTNET_ROOT: path.resolve('.tools/dotnet'),
};
delete environment.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
if (packaged) delete environment.DOTNET_ROOT;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/X SpeedUp.exe'), args: [] }
    : { args: ['.'] }),
  env: environment,
});
const errors = [];
let page;
let originalTheme;
const themeNames = { light: 'Светлая тема', dark: 'Тёмная тема' };
async function ready() {
  await page.getByText('Подключено к Windows', { exact: true }).waitFor({ timeout: 30000 });
  await page.locator('.working').waitFor({ state: 'hidden' });
}
async function selectTheme(theme) {
  const button = page.getByRole('button', { name: themeNames[theme], exact: true });
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
}
async function captureThemes(section) {
  await ready();
  for (const theme of ['light', 'dark']) {
    await selectTheme(theme);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, `${section}/${theme} must fit the window`);
    await page.screenshot({
      path: `artifacts/screenshots/${section}-${theme}.png`,
      fullPage: true,
    });
  }
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await ready();
  originalTheme = await page.evaluate(() => localStorage.getItem('xspeedup.theme'));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.removeItem('xspeedup.theme'));
  await page.reload();
  await ready();
  assert.equal(
    await page.locator('html').getAttribute('data-theme'),
    'dark',
    'First launch follows the system theme',
  );
  await selectTheme('light');
  await page.reload();
  await ready();
  assert.equal(
    await page.locator('html').getAttribute('data-theme'),
    'light',
    'Explicit choice survives a reload and overrides the system',
  );
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).press('Enter');
  assert.equal(
    await page.locator('html').getAttribute('data-theme'),
    'dark',
    'Theme switch works from the keyboard',
  );
  await captureThemes('overview');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 720));
  await captureThemes('overview-compact');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 900));

  await page.getByRole('button', { name: 'Анализировать систему', exact: true }).click();
  await page
    .getByRole('button', { name: 'Повторить анализ', exact: true })
    .waitFor({ timeout: 45000 });
  const cleanupButton = page.getByRole('button', { name: 'Очистить выбранное', exact: true });
  assert.equal(await cleanupButton.isDisabled(), true);
  const selectable = page.locator('input[type="checkbox"]:enabled');
  if (await selectable.count()) {
    await selectable.first().check();
    await selectTheme('light');
    assert.equal(
      await selectable.first().isChecked(),
      true,
      'Theme switching preserves selections',
    );
    await selectable.first().uncheck();
  }
  await captureThemes('cleanup');

  const nav = page.getByRole('navigation');
  await nav.getByRole('button', { name: 'Реестр', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить реестр', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить снова', exact: true }).waitFor();
  await captureThemes('registry');
  await nav.getByRole('button', { name: 'Службы Windows', exact: true }).click();
  await page.getByText('DiagTrack', { exact: true }).waitFor();
  await captureThemes('services');
  await nav.getByRole('button', { name: 'Приложения', exact: true }).click();
  await ready();
  await captureThemes('processes');
  await page.getByPlaceholder('Найти приложение…').fill('definitely-no-such-app-482932');
  await page.getByText('Приложения не найдены', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'История', exact: true }).click();
  await page.getByRole('heading', { name: 'Все изменения на виду.', exact: true }).waitFor();
  await captureThemes('history');

  const rejected = await page.evaluate(async () => {
    try {
      await window.desktop.request('exec', { command: 'anything' });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  assert.deepEqual(errors, []);
  console.log(
    'Desktop smoke passed: all six screens in both themes, theme persistence/system fallback/keyboard control, minimum window size, real Windows reads and isolated IPC. No maintenance actions executed.',
  );
} finally {
  if (page && originalTheme !== undefined) {
    await page
      .evaluate((saved) => {
        if (saved === null) localStorage.removeItem('xspeedup.theme');
        else localStorage.setItem('xspeedup.theme', saved);
      }, originalTheme)
      .catch(() => {});
  }
  await app.close();
}
