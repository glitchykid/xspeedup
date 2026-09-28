import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createTranslator, locales } from '../shared/i18n.ts';

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
let original;
let language = 'ru';
const t = (key) => createTranslator(language)(key);
async function ready() {
  await page
    .locator('.connection')
    .filter({ hasText: t('connected') })
    .waitFor({ state: 'attached', timeout: 35000 });
  await page.locator('.working').waitFor({ state: 'hidden', timeout: 35000 });
}
async function selectLanguage(value) {
  await page.locator('select.language-select').selectOption(value);
  language = value;
  await ready();
}
async function capture(section) {
  await ready();
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: t(theme), exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${section}/${theme} fits the window`,
    );
    const active = page.locator('nav button.active');
    await page.mouse.move(0, 0);
    const before = await active.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(el).color,
    ]);
    await active.hover();
    const after = await active.evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(el).color,
    ]);
    assert.deepEqual(after, before, 'Active navigation colors do not invert on hover');
    await page.screenshot({
      path: `artifacts/screenshots/${section}-${theme}.png`,
      fullPage: true,
    });
  }
}
async function navigate(id) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: t(id), exact: true })
    .click();
  await ready();
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('select.language-select').waitFor();
  original = await page.evaluate(() => ({
    theme: localStorage.getItem('xspeedup.theme'),
    locale: localStorage.getItem('xspeedup.locale'),
  }));
  await selectLanguage('ru');
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
    'Initial theme follows system preference',
  );
  await page.getByRole('button', { name: t('light'), exact: true }).press('Enter');
  await page.reload();
  await ready();
  assert.equal(
    await page.locator('html').getAttribute('data-theme'),
    'light',
    'Explicit theme persists and overrides system',
  );
  assert.equal(
    await page.locator('.hero-art').evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
    'Generated hero loads from packaged assets',
  );
  await capture('overview');
  assert.equal(
    await page
      .locator('.generated-icon')
      .first()
      .evaluate(async (element) => {
        const source = getComputedStyle(element).backgroundImage.slice(5, -2);
        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth === img.naturalHeight * 2);
          img.onerror = () => resolve(false);
          img.src = source;
        });
      }),
    true,
    'Generated navigation atlas loads with the expected 4 by 2 cell geometry',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 720));
  for (const locale of locales) {
    await selectLanguage(locale);
    await capture(`overview-${locale}-compact`);
  }
  await page.reload();
  await ready();
  assert.equal(
    await page.locator('html').getAttribute('lang'),
    'zh',
    'Language choice survives reload',
  );
  await selectLanguage('ru');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 900));
  await page.getByRole('button', { name: t('analyze'), exact: true }).click();
  await ready();
  assert.equal(
    await page.getByRole('button', { name: t('clean'), exact: true }).isDisabled(),
    true,
  );
  const selectable = page.locator('input[type="checkbox"]:enabled');
  if (await selectable.count()) {
    await selectable.first().check();
    await selectLanguage('en');
    await page.getByRole('button', { name: t('dark'), exact: true }).click();
    assert.equal(
      await selectable.first().isChecked(),
      true,
      'Language/theme changes preserve selections',
    );
    await selectable.first().uncheck();
    await selectLanguage('ru');
  }
  await capture('cleanup');
  await navigate('folders');
  await page.getByRole('button', { name: t('scan'), exact: true }).click();
  await ready();
  assert.equal(
    await page.getByRole('button', { name: t('deleteFolders'), exact: true }).isDisabled(),
    true,
  );
  await capture('folders');
  await navigate('registry');
  await page.getByRole('button', { name: t('scan'), exact: true }).click();
  await ready();
  await page.getByRole('button', { name: t('rescan'), exact: true }).waitFor();
  await capture('registry');
  await navigate('services');
  await page.getByText('DiagTrack', { exact: true }).waitFor();
  await capture('services');
  await navigate('processes');
  await capture('processes');
  // Capture and cancel a localized native confirmation. The real agent never receives a mutation.
  await app.evaluate(({ dialog }) => {
    globalThis.__confirmation = null;
    globalThis.__originalDialog = dialog.showMessageBox;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__confirmation = options;
      return { response: 0, checkboxChecked: false };
    };
  });
  const eligible = await page.evaluate(() => window.desktop.request('processes.list', {}));
  if (eligible.length) {
    await selectLanguage('ko');
    const canceled = await page.evaluate(async (p) => {
      try {
        await window.desktop.request('memory.release', { processId: p.id, startTime: p.startTime });
        return false;
      } catch {
        return true;
      }
    }, eligible[0]);
    assert.equal(canceled, true);
    const dialog = await app.evaluate(() => globalThis.__confirmation);
    assert.equal(dialog.buttons[0], t('cancel'));
    assert.equal(dialog.detail, t('memoryNote'));
    await selectLanguage('ru');
  }
  await page.getByPlaceholder(t('searchApps')).fill('definitely-no-such-app-482932');
  await page.getByRole('heading', { name: t('nothing'), exact: true }).waitFor();
  await navigate('history');
  await capture('history');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 720));
  for (const locale of locales) {
    await selectLanguage(locale);
    for (const id of ['cleanup', 'folders', 'registry', 'services', 'processes', 'history']) {
      await navigate(id);
      assert.equal(await page.locator('h1').innerText(), t(`title.${id}`));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
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
    'Desktop smoke passed: seven screens, both themes, six locales, active-tab hover, persistence, assets, minimum window size, read-only Windows scans and IPC isolation. No maintenance actions executed.',
  );
} finally {
  if (page && original)
    await page
      .evaluate((saved) => {
        for (const [name, value] of Object.entries(saved)) {
          const key = `xspeedup.${name}`;
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, original)
      .catch(() => {});
  await app.close();
}
