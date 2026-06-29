import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffModels, isEmptyDelta, summarizeDelta } from '../src/shared/model/diff';
import type { ArchitectureModel } from '../src/shared/model/types';

function model(
  nodes: ArchitectureModel['nodes'],
  edges: ArchitectureModel['edges'] = [],
  groups: ArchitectureModel['groups'] = [],
): ArchitectureModel {
  return { version: 1, nodes, edges, groups };
}

const node = (id: string, over: Partial<ArchitectureModel['nodes'][number]> = {}) => ({
  id,
  name: id,
  type: 'service' as const,
  description: '',
  position: { x: 0, y: 0 },
  ...over,
});

test('position-only moves are not a change', () => {
  const a = model([node('x')]);
  const b = model([node('x', { position: { x: 999, y: 999 } })]);
  assert.equal(isEmptyDelta(diffModels(a, b)), true);
});

test('detects added and removed nodes', () => {
  const a = model([node('x')]);
  const b = model([node('y')]);
  const delta = diffModels(a, b);
  assert.equal(delta.addedNodes[0].id, 'y');
  assert.equal(delta.removedNodes[0].id, 'x');
});

test('detects node field updates and reports kinds', () => {
  const a = model([node('x', { name: 'Old', type: 'service' })]);
  const b = model([node('x', { name: 'New', type: 'database' })]);
  const delta = diffModels(a, b);
  assert.deepEqual(delta.updatedNodes[0].changes.sort(), ['name', 'type']);
});

test('detects added edges and protocol changes', () => {
  const base = model([node('a'), node('b')], [
    { id: 'e', source: 'a', target: 'b', protocol: 'http' },
  ]);
  const next = model([node('a'), node('b')], [
    { id: 'e', source: 'a', target: 'b', protocol: 'grpc' },
    { id: 'e2', source: 'b', target: 'a', protocol: 'http' },
  ]);
  const delta = diffModels(base, next);
  assert.equal(delta.addedEdges.length, 1);
  assert.equal(delta.updatedEdges[0].after.protocol, 'grpc');
});

test('summarizeDelta renders human lines', () => {
  const a = model([node('x')]);
  const b = model([node('y', { type: 'cache' })]);
  const lines = summarizeDelta(diffModels(a, b));
  assert.ok(lines.some((l) => /Add cache/.test(l)));
  assert.ok(lines.some((l) => /Remove service/.test(l)));
});

test('detects an edge rewire that keeps the same id', () => {
  const base = model([node('a'), node('b'), node('c')], [
    { id: 'e', source: 'a', target: 'b', protocol: 'http' },
  ]);
  const next = model([node('a'), node('b'), node('c')], [
    { id: 'e', source: 'a', target: 'c', protocol: 'http' },
  ]);
  const delta = diffModels(base, next);
  assert.equal(isEmptyDelta(delta), false);
  assert.deepEqual(delta.updatedEdges[0].changes, ['endpoints']);
  assert.ok(summarizeDelta(delta).some((l) => /Rewire connection/.test(l)));
});

test('detects a group rename/description update', () => {
  const a = model([], [], [{ id: 'g', name: 'Old', description: 'a' }]);
  const b = model([], [], [{ id: 'g', name: 'New', description: 'b' }]);
  const delta = diffModels(a, b);
  assert.equal(isEmptyDelta(delta), false);
  assert.deepEqual(delta.updatedGroups[0].changes.sort(), ['description', 'name']);
  assert.ok(summarizeDelta(delta).some((l) => /Update bounded context/.test(l)));
});

test('detects group changes and membership moves', () => {
  const a = model([node('x')], [], []);
  const b = model([node('x', { groupId: 'orders' })], [], [{ id: 'orders', name: 'Orders' }]);
  const delta = diffModels(a, b);
  assert.equal(delta.addedGroups[0].id, 'orders');
  assert.deepEqual(delta.updatedNodes[0].changes, ['group']);
  assert.ok(summarizeDelta(delta).some((l) => /Add bounded context/.test(l)));
});
