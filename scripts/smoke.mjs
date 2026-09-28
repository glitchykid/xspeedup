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
// Prove that the packaged agent does not depend on the development SDK.
if (packaged) delete environment.DOTNET_ROOT;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/X SpeedUp.exe'), args: [] }
    : { args: ['.'] }),
  env: environment,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('Подключено к Windows', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  await page.screenshot({ path: 'artifacts/screenshots/overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Анализировать систему', exact: true }).click();
  await page
    .getByRole('button', { name: 'Повторить анализ', exact: true })
    .waitFor({ timeout: 45000 });
  assert.equal(
    await page.getByRole('button', { name: 'Очистить выбранное', exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ path: 'artifacts/screenshots/cleanup.png', fullPage: true });
  await page.getByRole('navigation').getByRole('button', { name: 'Реестр', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить реестр', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить снова', exact: true }).waitFor();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Службы Windows', exact: true })
    .click();
  await page.getByText('DiagTrack', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/screenshots/services.png', fullPage: true });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Приложения', exact: true })
    .click();
  await page.getByPlaceholder('Найти приложение…').fill('definitely-no-such-app-482932');
  await page.getByText('Приложения не найдены', { exact: true }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: 'История', exact: true }).click();
  await page.getByRole('heading', { name: 'Все изменения на виду.', exact: true }).waitFor();
  // Rejected requests cannot cross the IPC boundary, even when injected directly into the renderer.
  const rejected = await page.evaluate(async () => {
    try {
      await window.desktop.request('exec', { command: 'anything' });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  console.log(
    'Desktop smoke passed: real Windows reads, all six screens, isolated renderer, invalid IPC rejection; no maintenance actions executed.',
  );
} finally {
  await app.close();
}
