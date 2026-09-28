import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, locales, messages, validLocale } from '../shared/i18n';
import { validateRequest, isMutation } from '../electron/validation';

test('all six locales cover every UI and confirmation message', () => {
  for (const [key, values] of Object.entries(messages)) {
    assert.equal(values.length, locales.length, key);
    for (const locale of locales) {
      assert.ok(createTranslator(locale)(key).trim().length > 0, `${locale}/${key}`);
      assert.equal(
        createTranslator(locale)(key),
        values[locales.indexOf(locale)],
        `${locale}/${key}`,
      );
    }
  }
  assert.equal(validLocale('unsupported'), 'en');
});
test('new maintenance routes keep path authority out of renderer requests', () => {
  assert.throws(() => validateRequest('folders.scan', { root: 'C:\\' }));
  assert.throws(() => validateRequest('folders.apply', { scanId: 'id', entryIds: ['C:\\data'] }));
  assert.throws(() =>
    validateRequest('folders.apply', { scanId: 'id', entryIds: Array(257).fill('id') }),
  );
  assert.throws(() =>
    validateRequest('memory.release', { processId: 1, startTime: 'x', all: true }),
  );
  assert.throws(() => validateRequest('memory.release', { processId: 0, startTime: 'x' }));
  assert.equal(validateRequest('folders.continue', { scanId: 'id' }).method, 'folders.continue');
  assert.equal(isMutation('folders.apply'), true);
  assert.equal(isMutation('memory.release'), true);
  assert.equal(isMutation('folders.continue'), false);
});
