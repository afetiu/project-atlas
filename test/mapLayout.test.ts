import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeMapLayout } from '../src/shared/model/mapLayout';
import type { NodeTypeId } from '../src/shared/model/nodeTypes';

const node = (id: string, type: NodeTypeId, groupId?: string) => ({ id, type, groupId });

test('clusters members of a district together, apart from another district', () => {
  const pos = computeMapLayout([
    node('a', 'service', 'g1'),
    node('b', 'database', 'g1'),
    node('c', 'service', 'g2'),
    node('d', 'database', 'g2'),
  ]);
  const dist = (p: { x: number }, q: { x: number }) => Math.abs(p.x - q.x);
  // a and b (same district) are closer than a and c (different districts).
  assert.ok(dist(pos.get('a')!, pos.get('b')!) < dist(pos.get('a')!, pos.get('c')!));
});

test('data flows west→east within a district (frontend left of database)', () => {
  const pos = computeMapLayout([
    node('web', 'frontend', 'g1'),
    node('svc', 'service', 'g1'),
    node('db', 'database', 'g1'),
  ]);
  assert.ok(pos.get('web')!.x < pos.get('svc')!.x);
  assert.ok(pos.get('svc')!.x < pos.get('db')!.x);
});

test('is deterministic', () => {
  const nodes = [node('a', 'service', 'g1'), node('b', 'database', 'g2')];
  assert.deepEqual([...computeMapLayout(nodes).entries()], [...computeMapLayout(nodes).entries()]);
});

test('handles ungrouped nodes without crashing', () => {
  const pos = computeMapLayout([node('a', 'service'), node('b', 'frontend', 'g1')]);
  assert.equal(pos.size, 2);
  assert.ok(Number.isFinite(pos.get('a')!.x));
});
