import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyCodegen } from '../src/extension/ai/verify';
import type { ModelDelta } from '../src/shared/model/diff';
import type { ArchitectureModel, ArchitectureNode } from '../src/shared/model/types';

const node = (id: string, path?: string): ArchitectureNode => ({
  id,
  name: id,
  type: 'service',
  description: '',
  position: { x: 0, y: 0 },
  ...(path ? { mapping: { path } } : {}),
});

function deltaAdding(nodes: ArchitectureNode[]): ModelDelta {
  return {
    addedNodes: nodes,
    removedNodes: [],
    updatedNodes: [],
    addedEdges: [],
    removedEdges: [],
    updatedEdges: [],
    addedGroups: [],
    removedGroups: [],
  };
}

test('passes when mapped code exists', async () => {
  const present = node('pkg', 'package.json'); // exists in repo root
  const model: ArchitectureModel = { version: 1, nodes: [present], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([present]), model, undefined);
  assert.equal(report.ok, true);
  assert.equal(report.checks[0].ok, true);
});

test('fails when mapped code is missing', async () => {
  const missing = node('ghost', 'no/such/path-xyz');
  const model: ArchitectureModel = { version: 1, nodes: [missing], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([missing]), model, undefined);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => !c.ok));
});

test('is trivially ok when nothing to check', async () => {
  const model: ArchitectureModel = { version: 1, nodes: [node('a')], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([node('a')]), model, undefined);
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 0);
});
