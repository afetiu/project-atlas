import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findPath } from '../src/shared/model/path';
import type { ArchitectureModel } from '../src/shared/model/types';

const n = (id: string) => ({ id, name: id, type: 'service' as const, description: '', position: { x: 0, y: 0 } });
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t, protocol: 'http' as const });
const model = (nodes: string[], edges: Array<[string, string]>): ArchitectureModel => ({
  version: 1,
  nodes: nodes.map(n),
  edges: edges.map(([s, t]) => e(s, t)),
  groups: [],
});

test('finds the shortest forward route', () => {
  const m = model(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'd']]);
  const p = findPath(m, 'a', 'd')!;
  assert.deepEqual(p.nodeIds, ['a', 'd']); // direct edge beats the 3-hop route
  assert.deepEqual(p.edgeIds, ['a-d']);
  assert.equal(p.reversed, false);
});

test('falls back to the reverse direction', () => {
  const m = model(['a', 'b'], [['b', 'a']]);
  const p = findPath(m, 'a', 'b')!;
  assert.equal(p.reversed, true);
  assert.deepEqual(p.nodeIds, ['b', 'a']);
});

test('returns null when no route exists either way', () => {
  const m = model(['a', 'b', 'x'], [['a', 'b']]);
  assert.equal(findPath(m, 'a', 'x'), null);
});
