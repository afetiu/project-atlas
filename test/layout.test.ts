import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeLayout } from '../src/shared/model/layout';

test('places roots in the first column and dependents rightward', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];
  const pos = computeLayout(nodes, edges);
  assert.ok(pos.get('a')!.x < pos.get('b')!.x);
  assert.ok(pos.get('b')!.x < pos.get('c')!.x);
});

test('is deterministic', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b' }];
  assert.deepEqual(
    [...computeLayout(nodes, edges).entries()],
    [...computeLayout(nodes, edges).entries()],
  );
});

test('handles cycles without infinite looping', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ];
  const pos = computeLayout(nodes, edges);
  assert.equal(pos.size, 2);
});

test('cycle members are laid out deterministically regardless of input order', () => {
  // A feeds a 3-cycle; the layout must not depend on node array order.
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' },
    { source: 'root', target: 'a' },
  ];
  const order1 = [{ id: 'root' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
  const order2 = [{ id: 'c' }, { id: 'b' }, { id: 'a' }, { id: 'root' }];
  const p1 = computeLayout(order1, edges);
  const p2 = computeLayout(order2, edges);
  for (const id of ['root', 'a', 'b', 'c']) {
    assert.deepEqual(p1.get(id), p2.get(id), `node ${id} differs across input order`);
  }
  // And cycle members must not all collapse onto the root's column.
  assert.ok(p1.get('a')!.x > p1.get('root')!.x);
});
