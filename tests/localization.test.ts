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
    validateRequest('folders.apply', { scanId: 'id', entryIds: Array(100001).fill('id') }),
  );
  assert.throws(() =>
    validateRequest('memory.release', { processId: 1, startTime: 'x', all: true }),
  );
  assert.throws(() => validateRequest('memory.release', { processId: 0, startTime: 'x' }));
  assert.equal(validateRequest('folders.continue', { scanId: 'id' }).method, 'folders.continue');
  assert.equal(isMutation('folders.apply'), true);
  assert.equal(isMutation('memory.release'), true);
  assert.equal(isMutation('folders.continue'), false);
  assert.equal(
    validateRequest('folders.apply', { scanId: 'id', entryIds: 'all' }).method,
    'folders.apply',
  );
  assert.equal(validateRequest('folders.scan', { scope: 'selected' }).method, 'folders.scan');
  assert.throws(() => validateRequest('folders.scan', { scope: 'selected', root: 'C:\\Windows' }));
  assert.throws(() => validateRequest('folders.scan', { scope: 'C:\\Windows' }));
});
test('gaming only accepts the balanced service catalog and explicit process identities', () => {
  assert.equal(
    validateRequest('gaming.start', { serviceIds: [], processes: [] }).method,
    'gaming.start',
  );
  assert.equal(isMutation('gaming.start'), true);
  assert.equal(isMutation('gaming.stop'), true);
  assert.throws(() =>
    validateRequest('gaming.start', { serviceIds: ['WinDefend'], processes: [] }),
  );
  assert.throws(() =>
    validateRequest('gaming.start', {
      serviceIds: [],
      processes: [{ id: 1, startTime: 'x', command: 'evil' }],
    }),
  );
  assert.throws(() =>
    validateRequest('gaming.start', {
      serviceIds: [],
      processes: [
        { id: 1, startTime: 'x' },
        { id: 1, startTime: 'x' },
      ],
    }),
  );
  assert.throws(() => validateRequest('gaming.settings', { url: 'https://example.org' }));
});
