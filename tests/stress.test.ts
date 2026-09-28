import test from 'node:test';
import { allWorkersVerified } from '../src/lib/stress/workers';
import assert from 'node:assert/strict';

test('every requested worker must contribute a verified pass', () => {
  assert.equal(
    allWorkersVerified(
      new Map([
        [0, 100],
        [1, 1],
      ]),
      3,
    ),
    false,
  );
  assert.equal(
    allWorkersVerified(
      new Map([
        [0, 100],
        [1, 1],
        [2, 0],
      ]),
      3,
    ),
    false,
  );
  assert.equal(
    allWorkersVerified(
      new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ]),
      3,
    ),
    true,
  );
  assert.equal(allWorkersVerified(new Map(), 0), true);
});
import { mesh, hash, frameStats } from '../src/lib/stress/math';
import { validateRequest, isMutation } from '../electron/validation';
test('procedural geometry has bounded valid indices and finite vertices', () => {
  const data = mesh(256, 48);
  assert.equal((data.indices.length / 3) * 96, 2359296);
  assert.ok(data.vertices.every(Number.isFinite));
  assert.ok(data.indices.every((i) => i < data.vertices.length / 3));
});
test('frame summaries use frame times and mean of slowest one percent', () => {
  const stats = frameStats([...Array(99).fill(10), 100]);
  assert.equal(stats.low, 10);
  assert.equal(stats.p99, 10);
  assert.ok(stats.fps < 100);
  assert.equal(frameStats([]).fps, 0);
  assert.equal(hash(0), 0);
  assert.equal(hash(1), 1753845952);
});
test('tuning API only accepts session operations and never arbitrary clocks', () => {
  assert.equal(isMutation('tuning.start'), true);
  assert.equal(isMutation('tuning.finish'), false);
  assert.equal(
    validateRequest('tuning.finish', { id: 'abc', completed: false }).method,
    'tuning.finish',
  );
  assert.throws(() => validateRequest('tuning.advance', { id: 'abc', offset: 5000 }));
  assert.throws(() => validateRequest('tuning.finish', { id: 'abc', completed: 'true' }));
});
