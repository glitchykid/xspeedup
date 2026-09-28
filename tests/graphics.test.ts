import test from 'node:test';
import assert from 'node:assert/strict';
import { multiply, perspective, view } from '../src/lib/stress/matrix';
test('camera projection maps the look-at target to the viewport center and keeps front geometry in depth range', () => {
  const p = multiply(perspective(16 / 9), view([0, 0, 9], [0, 0, 0]));
  const clip = [p[12], p[13], p[14], p[15]];
  assert.ok(Math.abs(clip[0] / clip[3]) < 1e-6 && Math.abs(clip[1] / clip[3]) < 1e-6);
  assert.ok(clip[2] / clip[3] > -1 && clip[2] / clip[3] < 1);
  assert.ok([...p].every(Number.isFinite));
});
