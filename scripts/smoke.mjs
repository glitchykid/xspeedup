import { _electron as electron } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createTranslator, locales } from '../shared/i18n.ts';

await mkdir('artifacts/screenshots', { recursive: true });
const fixture = path.resolve('.cache/desktop-folders');
await mkdir(fixture, { recursive: true });
await Promise.all(
  Array.from({ length: 5103 }, (_, i) =>
    mkdir(path.join(fixture, `empty-${i.toString().padStart(5, '0')}`), { recursive: true }),
  ),
);
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
let page,
  original,
  language = 'ru';
const t = (key) => createTranslator(language)(key);
async function ready(timeout = 90000) {
  await page
    .locator('.connection')
    .filter({ hasText: t('connected') })
    .waitFor({ state: 'attached', timeout });
  await page.locator('.working').waitFor({ state: 'hidden', timeout });
}
async function locale(value) {
  await page.locator('select.language-select').selectOption(value);
  language = value;
  await ready();
  await page.waitForFunction((value) => document.documentElement.lang === value, value);
}
async function navigate(id) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: t(id), exact: true })
    .click();
  await ready();
}
async function capture(id) {
  await ready();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${id} fits window`,
  );
  const active = page.locator('nav button.active');
  await page.mouse.move(0, 0);
  const colors = (el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color];
  const before = await active.evaluate(colors);
  await active.hover();
  assert.deepEqual(await active.evaluate(colors), before);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `artifacts/screenshots/${id}-dark.png`, fullPage: true });
}
async function dockVisible() {
  for (const bottom of [false, true]) {
    await page.evaluate((bottom) => scrollTo(0, bottom ? document.body.scrollHeight : 0), bottom);
    const box = await page.locator('.action-bar').boundingBox();
    const size =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    assert.ok(
      box &&
        box.y >= 0 &&
        box.y + box.height <= size.height &&
        box.x >= 190 &&
        box.x + box.width <= size.width,
      'Action dock stays in viewport',
    );
  }
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('select.language-select').waitFor();
  original = await page.evaluate(() => ({
    theme: localStorage.getItem('xspeedup.theme'),
    locale: localStorage.getItem('xspeedup.locale'),
  }));
  await locale('ru');
  // Migrate a previous light preference to the requested dark-only interface.
  await page.evaluate(() => localStorage.setItem('xspeedup.theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await ready();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.ok(preferences.contextIsolation && preferences.sandbox && !preferences.nodeIntegration);
  assert.ok(
    await page.locator('.hero-art').evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  assert.equal(await page.locator('svg').count(), 0, 'Production icons use PNG assets');
  assert.ok(
    await page.locator('.hero-art').evaluate((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return false;
      return true;
    }),
    'Application icon has no transparent pixels',
  );
  assert.ok(
    await page
      .locator('nav .raster-icon')
      .first()
      .evaluate(async (img) => {
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        return (
          pixels[3] === 0 && pixels.some((alpha, i) => i % 4 === 3 && alpha > 0 && alpha < 255)
        );
      }),
    'Internal icons have transparent backgrounds and antialiased edges',
  );
  assert.ok(
    (await page.locator('nav .raster-icon').count()) === 9,
    'Transparent raster navigation icons load',
  );
  await capture('overview');
  await app.evaluate(({ dialog }, fixture) => {
    globalThis.__originalOpen = dialog.showOpenDialog;
    globalThis.__originalConfirm = dialog.showMessageBox;
    globalThis.__choice = fixture;
    globalThis.__confirm = null;
    dialog.showOpenDialog = async () =>
      globalThis.__choice
        ? { canceled: false, filePaths: [globalThis.__choice] }
        : { canceled: true, filePaths: [] };
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__confirm = options;
      return { response: 0, checkboxChecked: false };
    };
  }, fixture);
  await page.getByRole('button', { name: t('analyze'), exact: true }).click();
  await ready();
  const master = page.locator('.select-all input');
  if (await master.isEnabled()) {
    await master.check();
    const enabled = page.locator('.item-list input[type=checkbox]:enabled');
    assert.equal(
      await enabled.count(),
      await page.locator('.item-list input[type=checkbox]:checked').count(),
    );
    await locale('en');
    assert.ok(await master.isChecked());
    await locale('ru');
    if ((await enabled.count()) > 1) {
      await enabled.first().uncheck();
      assert.ok(await master.evaluate((el) => el.indeterminate));
    }
    await master.check();
    await app.evaluate(() => (globalThis.__confirm = null));
    await page.getByRole('button', { name: t('clean'), exact: true }).click();
    await ready();
    assert.ok(
      await app.evaluate(() => globalThis.__confirm),
      'Selected reactive categories reach the native confirmation',
    );
    await master.uncheck();
  }
  await dockVisible();
  await capture('cleanup');
  await navigate('folders');
  await page.getByRole('button', { name: t('chooseFolder'), exact: true }).click();
  await ready();
  assert.equal(await page.getByLabel(t('scanScope'), { exact: true }).inputValue(), 'selected');
  await app.evaluate(() => (globalThis.__choice = null));
  await page.getByRole('button', { name: t('chooseFolder'), exact: true }).click();
  await ready();
  assert.ok(
    await page
      .locator('.folder-scope')
      .innerText()
      .then((text) => text.includes(fixture)),
    'Cancel keeps previous folder choice',
  );
  await page.getByRole('button', { name: t('scan'), exact: true }).click();
  await ready();
  await page.getByText(t('complete'), { exact: true }).waitFor();
  assert.ok(
    (await page.locator('.summary-panel h2').innerText()).includes('5103'),
    'All slices complete automatically beyond 5000',
  );
  assert.ok(
    (await page.locator('.folder-list input[type=checkbox]').count()) < 30,
    'Rows fit the available window height',
  );
  await master.check();
  assert.ok((await page.locator('.action-bar').innerText()).includes('5103'));
  await page.locator('.folder-list input[type=checkbox]').first().uncheck();
  assert.ok(
    (await page.locator('.action-bar').innerText()).includes('5102'),
    'Unchecking one row preserves all other pages',
  );
  await page
    .locator('.folder-list')
    .getByRole('button', { name: t('next'), exact: true })
    .click();
  await page.locator('.folder-list input[type=checkbox]').first().uncheck();
  assert.ok(
    (await page.locator('.action-bar').innerText()).includes('5101'),
    'Unchecking a second page preserves hidden selections',
  );
  await page
    .locator('.folder-list')
    .getByRole('button', { name: t('previous'), exact: true })
    .click();
  assert.equal(await page.locator('.folder-list input[type=checkbox]').first().isChecked(), false);
  await master.check();
  await page.getByPlaceholder(t('filter')).fill('empty-000');
  await master.uncheck();
  assert.ok(
    (await page.locator('.action-bar').innerText()).includes('5003'),
    'Filtered deselection preserves hidden choices',
  );
  await page.getByPlaceholder(t('filter')).fill('');
  assert.ok(await master.evaluate((el) => el.indeterminate));
  await master.check();
  await page.getByRole('button', { name: t('deleteFolders'), exact: true }).click();
  await ready();
  const confirm = await app.evaluate(() => globalThis.__confirm);
  assert.ok(confirm.detail.includes('5103'), 'Bulk confirmation covers every selected folder');
  assert.equal(
    (await readdir(fixture)).length,
    5103,
    'Canceled deletion leaves every fixture intact',
  );
  await master.uncheck();
  await dockVisible();
  await capture('folders');
  await navigate('registry');
  await page.getByRole('button', { name: t('scan'), exact: true }).click();
  await ready();
  if ((await master.count()) && (await master.isEnabled())) {
    await master.check();
    assert.equal(await page.locator('.registry-row input:disabled:checked').count(), 0);
    await master.uncheck();
    await dockVisible();
  }
  await capture('registry');
  await navigate('services');
  await dockVisible();
  await capture('services');
  await navigate('gaming');
  await dockVisible();
  await capture('gaming');
  if (await page.getByRole('button', { name: t('gameStart'), exact: true }).isEnabled()) {
    await locale('ko');
    await app.evaluate(() => (globalThis.__confirm = null));
    await page.getByRole('button', { name: t('gameStart'), exact: true }).click();
    await ready();
    const gaming = await app.evaluate(() => globalThis.__confirm);
    assert.ok(gaming, await page.locator('main').textContent());
    assert.equal(gaming.buttons[0], t('cancel'));
    assert.ok(gaming.detail.includes(t('gameNote')));
    await locale('ru');
  }
  await navigate('stress');
  await page.getByLabel(t('complexGeometry'), { exact: true }).uncheck();
  await page.getByLabel(t('duration'), { exact: true }).selectOption('3');
  const benchPromise = app.waitForEvent('window');
  await page.getByRole('button', { name: t('stressStart'), exact: true }).click();
  const bench = await benchPromise;
  bench.on('pageerror', (error) => errors.push(error.message));
  await bench.waitForSelector('.benchmark-header');
  assert.ok(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isFullScreen() && w.getParentWindow()),
    ),
    'Separate fullscreen child window',
  );
  const denied = await bench.evaluate(async () => {
    try {
      await window.desktop.request('services.list', {});
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(denied, 'Benchmark cannot invoke maintenance operations');
  await bench.waitForFunction(() =>
    document.querySelector('.bench-checks')?.textContent?.match(/GPU: [1-9]/),
  );
  await bench.screenshot({ path: 'artifacts/screenshots/fullscreen-benchmark.png' });
  await bench.getByText(t('stressDone'), { exact: true }).waitFor({ timeout: 30000 });
  assert.ok(
    (await bench.locator('.bench-checks').innerText()).includes('SSAO'),
    'Advanced effects default on',
  );
  await bench.keyboard.press('Escape');
  await bench.waitForEvent('close');
  await ready();
  await dockVisible();
  await capture('stress');
  await navigate('processes');
  await capture('processes');
  await navigate('history');
  await capture('history');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1020, 720));
  for (const value of locales) {
    await locale(value);
    for (const id of [
      'overview',
      'cleanup',
      'folders',
      'registry',
      'services',
      'gaming',
      'stress',
      'processes',
      'history',
    ]) {
      await navigate(id);
      assert.equal(await page.locator('h1').innerText(), t(`title.${id}`));
      if (id === 'stress') {
        for (const hardware of ['CPU', 'RAM', 'SSD', 'GPU']) {
          await page
            .locator('.inner-tabs')
            .getByRole('button', { name: hardware, exact: true })
            .click();
          assert.ok(
            await page.evaluate(
              () =>
                document.querySelector('main').scrollHeight <=
                document.querySelector('main').clientHeight + 1,
            ),
            value + '/' + hardware + ' hardware tab fits',
          );
        }
        await page.locator('main > .notice .details-button').click();
        const dialog = page.locator('dialog[open]');
        await dialog.waitFor();
        assert.ok(
          await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
          'Details use pages instead of scrolling',
        );
        for (const box of await dialog
          .locator('.detail-text')
          .evaluateAll((els) =>
            els.map((el) => ({ scroll: el.scrollHeight, height: el.clientHeight })),
          ))
          assert.ok(box.scroll <= box.height, value + ' complete detail text fits each row');
        await dialog.getByRole('button', { name: t('close'), exact: true }).click();
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${value}/${id} compact width`,
      );
      const outside = await page.evaluate(() =>
        [...document.querySelectorAll('main button, main input, main h2, .page-rows > *')]
          .filter((el) => {
            if (!el.getClientRects().length || el.closest('details:not([open])')) return false;
            const r = el.getBoundingClientRect();
            return r.bottom > innerHeight || r.top < 0 || r.right > innerWidth;
          })
          .map((el) => el.textContent?.slice(0, 80) || el.tagName),
      );
      assert.deepEqual(outside, [], value + '/' + id + ' content fits vertically');
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector('main').scrollHeight <=
            document.querySelector('main').clientHeight + 1,
        ),
        value + '/' + id + ' no main scrolling',
      );
      if (await page.locator('.action-bar').count()) await dockVisible();
    }
  }
  await page.reload();
  await ready();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh');
  const rejected = await page.evaluate(async () => {
    try {
      await window.desktop.request('folders.scan', { scope: 'selected', root: 'C:\\Windows' });
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(rejected);
  assert.deepEqual(errors, []);
  console.log(
    'Desktop smoke passed: nine screens, dark-only migration, six locales, bulk selection, filtered selection, canceled native dialogs, full selected-folder traversal beyond 5000 entries, fixed action docks, assets, renderer isolation and a 3-second low-load GPU render/readback test. No cleanup, service, registry or clock mutations executed.',
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
