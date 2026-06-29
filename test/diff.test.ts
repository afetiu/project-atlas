import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffModels, isEmptyDelta, summarizeDelta } from '../src/shared/model/diff';
import type { ArchitectureModel } from '../src/shared/model/types';

function model(nodes: ArchitectureModel['nodes'], edges: ArchitectureModel['edges'] = []): ArchitectureModel {
  return { version: 1, nodes, edges };
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
