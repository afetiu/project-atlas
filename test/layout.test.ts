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
