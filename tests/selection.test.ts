import test from 'node:test';
import assert from 'node:assert/strict';
import { selectId } from '../src/lib/selection';
test('unchecking a visible row preserves selected IDs on all other pages and filters', () => {
  const all = Array.from({ length: 5103 }, (_, i) => String(i));
  let selected = selectId(all, '3', false);
  selected = selectId(selected, '204', false);
  assert.equal(selected.length, 5101);
  assert.ok(selected.includes('5102') && selected.includes('0'));
  assert.ok(!selected.includes('3') && !selected.includes('204'));
  assert.equal(selectId(selected, '3', true).length, 5102);
  assert.equal(all.length, 5103);
});
