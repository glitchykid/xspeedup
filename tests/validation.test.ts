import test from 'node:test';
import assert from 'node:assert/strict';
import { isMutation, validateRequest } from '../electron/validation';
import { bytes } from '../src/lib/format';

test('IPC rejects arbitrary methods, paths, empty selection and malformed payloads', () => {
  assert.throws(() => validateRequest('exec', { command: 'anything' }));
  assert.throws(() => validateRequest('system', { path: 'C:\\' }));
  assert.throws(() =>
    validateRequest('cleanup.apply', { scanId: 'id', categoryIds: ['../outside'] }),
  );
  assert.throws(() => validateRequest('cleanup.apply', { scanId: 'id', categoryIds: [] }));
  assert.throws(() => validateRequest('history.restore', { id: 123 }));
  assert.throws(() => validateRequest('processes.close', { processId: -1, startTime: 'x' }));
  assert.throws(() => validateRequest('system', null));
  assert.throws(() => validateRequest('system', []));
});
test('IPC only accepts typed known requests', () => {
  assert.deepEqual(validateRequest('cleanup.apply', { scanId: 'id', categoryIds: ['temp'] }), {
    method: 'cleanup.apply',
    args: { scanId: 'id', categoryIds: ['temp'] },
  });
  assert.deepEqual(validateRequest('system', {}).args, {});
  assert.equal(isMutation('cleanup.apply'), true);
  assert.equal(isMutation('registry.apply'), true);
  assert.equal(isMutation('services.disable'), true);
  assert.equal(isMutation('processes.close'), true);
  assert.equal(isMutation('history.restore'), true);
  assert.equal(isMutation('cleanup.scan'), false);
});
test('zero, invalid and large metrics remain readable', () => {
  assert.equal(bytes(0), '0 Б');
  assert.equal(bytes(NaN), '0 Б');
  assert.equal(bytes(1024), '1 КБ');
  assert.equal(bytes(1024 ** 4), '1 ТБ');
});
test('fullscreen benchmark options and tuning interval are bounded and typed', () => {
  const options = {
    duration: 30,
    heavy: true,
    cpu: false,
    ram: false,
    automatic: false,
    stepSeconds: 45,
    ssao: true,
    bloom: true,
    shadows: true,
  };
  assert.equal(validateRequest('bench.open', options).method, 'bench.open');
  for (const stepSeconds of [0, 9, 121, NaN, 10.5, '45']) {
    assert.throws(() => validateRequest('tuning.start', { deviceId: 'GPU-fixture', stepSeconds }));
    assert.throws(() => validateRequest('bench.open', { ...options, stepSeconds }));
  }
  assert.throws(() => validateRequest('bench.open', { ...options, cpu: 'yes' }));
  assert.throws(() => validateRequest('bench.open', { ...options, duration: 601 }));
  assert.throws(() => validateRequest('bench.open', { ...options, path: 'arbitrary' }));
  assert.equal(
    validateRequest('tuning.start', { deviceId: 'GPU-fixture', stepSeconds: 120 }).method,
    'tuning.start',
  );
});
