import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeExtraction } from '../src/shared/extract/merge';
import type { ArchitectureModel } from '../src/shared/model/types';

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: 'service' as const,
  description: '',
  position: { x: 0, y: 0 },
  ...over,
});
const model = (
  nodes: ArchitectureModel['nodes'],
  edges: ArchitectureModel['edges'] = [],
  groups: ArchitectureModel['groups'] = [],
): ArchitectureModel => ({ version: 1, nodes, edges, groups });

test('preserves name, position, and binding for surviving components', () => {
  const existing = model([
    node('a', {
      name: 'My Renamed Service',
      position: { x: 500, y: 600 },
      binding: { server: 'postgres' },
      description: 'notes',
    }),
  ]);
  const extracted = model([node('a', { name: 'a', type: 'service', mapping: { path: 'src/a' } })]);
  const merged = mergeExtraction(existing, extracted);
  const a = merged.nodes.find((n) => n.id === 'a')!;
  assert.equal(a.name, 'My Renamed Service'); // intent kept
  assert.deepEqual(a.position, { x: 500, y: 600 }); // layout kept (spatial memory)
  assert.deepEqual(a.binding, { server: 'postgres' }); // live binding kept
  assert.equal(a.description, 'notes');
  assert.equal(a.mapping?.path, 'src/a'); // structure refreshed from code
});

test('adds newly-appeared components and drops vanished ones', () => {
  const existing = model([node('old'), node('keep', { name: 'Kept' })]);
  const extracted = model([node('keep'), node('new')]);
  const merged = mergeExtraction(existing, extracted);
  const ids = merged.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['keep', 'new']); // old dropped, new added
  assert.equal(merged.nodes.find((n) => n.id === 'keep')!.name, 'Kept');
});

test('structure (edges, groups, type) comes from the extracted model', () => {
  const existing = model(
    [node('a', { type: 'database' })],
    [{ id: 'x', source: 'a', target: 'a', protocol: 'http' }],
    [{ id: 'g-old', name: 'Old' }],
  );
  const extracted = model(
    [node('a', { type: 'service', groupId: 'g-new' })],
    [],
    [{ id: 'g-new', name: 'New' }],
  );
  const merged = mergeExtraction(existing, extracted);
  assert.equal(merged.nodes[0].type, 'service'); // type from code
  assert.equal(merged.nodes[0].groupId, 'g-new');
  assert.deepEqual(merged.groups, [{ id: 'g-new', name: 'New' }]);
  assert.equal(merged.edges.length, 0);
});
