import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createTranslator } from '../shared/i18n.ts';
const env = { ...process.env, XSPEEDUP_DEV: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
let bench;
try {
  const page = await app.firstWindow();
  await page.waitForSelector('nav');
  const t = createTranslator(await page.locator('html').getAttribute('lang'));
  await page.locator('.working').waitFor({ state: 'hidden' });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: t('stress'), exact: true })
    .click();
  await page.locator('.working').waitFor({ state: 'hidden' });
  await page.getByLabel(t('duration'), { exact: true }).selectOption('3');
  await page.getByLabel(t('complexGeometry'), { exact: true }).uncheck();
  await page.getByLabel('CPU', { exact: true }).check();
  await page.getByLabel('RAM', { exact: true }).check();
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: t('stressStart'), exact: true }).click();
  bench = await opened;
  await bench.getByText(t('stressDone'), { exact: true }).waitFor({ timeout: 30000 });
  const report = await bench.locator('.bench-checks').innerText();
  assert.match(report, /GPU: [1-9]/);
  assert.match(report, /CPU\+RAM: [1-9]/);
  assert.match(report, /FXAA/, 'Offscreen lighting must receive a final antialiasing pass');
  const preferences = await bench.evaluate(() =>
    document.querySelector('canvas').getContext('webgl2').getContextAttributes(),
  );
  assert.equal(preferences.antialias, true);
  console.log('Fullscreen GPU + CPU + RAM and antialiasing passed.');
  await bench.keyboard.press('Escape');
  await bench.waitForEvent('close');
  bench = null;
  await page.locator('.working').waitFor({ state: 'hidden' });
  await page.getByLabel(t('duration'), { exact: true }).selectOption('30');
  const second = app.waitForEvent('window');
  await page.getByRole('button', { name: t('stressStart'), exact: true }).click();
  bench = await second;
  await bench.waitForFunction(() =>
    /GPU: [1-9]/.test(document.querySelector('.bench-checks')?.textContent ?? ''),
  );
  // Native close while running must request stop and wait for renderer cleanup.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getParentWindow())
      ?.close(),
  );
  await bench.waitForEvent('close');
  bench = null;
  assert.equal(app.windows().length, 1);
  console.log('Native close stops active workers and releases the child window.');
  await page.locator('.working').waitFor({ state: 'hidden' });
  await page.getByLabel(t('duration'), { exact: true }).selectOption('3');
  await page.getByLabel(t('complexGeometry'), { exact: true }).check();
  await page.getByLabel('CPU', { exact: true }).uncheck();
  await page.getByLabel('RAM', { exact: true }).uncheck();
  const heavy = app.waitForEvent('window');
  await page.getByRole('button', { name: t('stressStart'), exact: true }).click();
  bench = await heavy;
  await bench.waitForFunction(() =>
    /GPU: [1-9]/.test(document.querySelector('.bench-checks')?.textContent ?? ''),
  );
  await bench.screenshot({ path: 'artifacts/screenshots/fullscreen-heavy.png' });
  await bench.getByText(t('stressDone'), { exact: true }).waitFor({ timeout: 30000 });
  assert.match((await bench.locator('.bench-checks').innerText()).replace(/[,\s]/g, ''), /2359728/);
  await bench.keyboard.press('Escape');
  await bench.waitForEvent('close');
  bench = null;
  console.log(
    'Default complex geometry and all effects passed a three-second render/readback check.',
  );
} finally {
  if (bench && !bench.isClosed()) {
    await bench.keyboard.press('Escape').catch(() => {});
    await bench.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  }
  await app.close();
}
