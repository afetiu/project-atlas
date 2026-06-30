import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeLens } from '../src/shared/model/lenses';
import type { ArchitectureModel } from '../src/shared/model/types';
import type { NodeTypeId } from '../src/shared/model/nodeTypes';

const n = (id: string, type: NodeTypeId = 'service', over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type,
  description: '',
  position: { x: 0, y: 0 },
  ...over,
});
const e = (source: string, target: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  protocol: 'http' as const,
});
const model = (
  nodes: ArchitectureModel['nodes'],
  edges: ArchitectureModel['edges'] = [],
): ArchitectureModel => ({ version: 1, nodes, edges, groups: [] });

test('structure lens paints nothing', () => {
  const o = computeLens(model([n('a'), n('b')], [e('a', 'b')]), 'structure');
  assert.equal(o.nodeTone.size, 0);
  assert.equal(o.edgeTone.size, 0);
});

test('risk lens marks cycle members danger', () => {
  const o = computeLens(model([n('a'), n('b')], [e('a', 'b'), e('b', 'a')]), 'risk');
  assert.equal(o.nodeTone.get('a'), 'danger');
  assert.equal(o.nodeTone.get('b'), 'danger');
});

test('drift lens warns drifted nodes, mutes the rest', () => {
  const o = computeLens(model([n('a'), n('b')]), 'drift', { driftedNodeIds: ['a'] });
  assert.equal(o.nodeTone.get('a'), 'warn');
  assert.equal(o.nodeTone.get('b'), 'muted');
});

test('coverage lens: mapped ok, unmapped warn, external muted', () => {
  const o = computeLens(
    model([
      n('a', 'service', { mapping: { path: 'svc/a' } }),
      n('b', 'service'),
      n('x', 'externalApi'),
    ]),
    'coverage',
  );
  assert.equal(o.nodeTone.get('a'), 'ok');
  assert.equal(o.nodeTone.get('b'), 'warn');
  assert.equal(o.nodeTone.get('x'), 'muted');
});

test('live lens marks bound nodes ok and unbound muted', () => {
  const o = computeLens(
    model([n('a', 'service', { binding: { server: 'postgres' } }), n('b')]),
    'live',
  );
  assert.equal(o.nodeTone.get('a'), 'ok');
  assert.equal(o.nodeTone.get('b'), 'muted');
});

test('coupling lens makes the busiest hub hot and weights roads', () => {
  // hub depends on 3 others; it should be the hottest.
  const o = computeLens(
    model([n('hub'), n('a'), n('b'), n('c')], [e('hub', 'a'), e('hub', 'b'), e('hub', 'c')]),
    'coupling',
  );
  assert.equal(o.nodeTone.get('hub'), 'hot');
  for (const id of ['hub-a', 'hub-b', 'hub-c']) {
    assert.ok((o.edgeWeight.get(id) ?? 0) >= 1);
  }
});
