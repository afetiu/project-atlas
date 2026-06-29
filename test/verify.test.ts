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
    updatedGroups: [],
  };
}

const opts = { command: undefined, trusted: true, touchedFiles: [] as string[] };

test('passes when mapped code exists', async () => {
  const present = node('pkg', 'package.json'); // exists in repo root
  const model: ArchitectureModel = { version: 1, nodes: [present], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([present]), model, opts);
  assert.equal(report.ok, true);
  assert.equal(report.checks[0].ok, true);
});

test('fails when mapped code is missing', async () => {
  const missing = node('ghost', 'no/such/path-xyz');
  const model: ArchitectureModel = { version: 1, nodes: [missing], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([missing]), model, opts);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => !c.ok));
});

test('rejects a mapped path that escapes the workspace', async () => {
  const escaped = node('evil', '../../../etc/passwd');
  const model: ArchitectureModel = { version: 1, nodes: [escaped], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([escaped]), model, opts);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => /outside the workspace/.test(c.detail ?? '')));
});

test('skips the verify command in an untrusted workspace', async () => {
  const model: ArchitectureModel = { version: 1, nodes: [node('a')], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([node('a')]), model, {
    command: 'echo should-not-run',
    trusted: false,
    touchedFiles: [],
  });
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((c) => /skipped/.test(c.label)));
});

test('is trivially ok when nothing to check', async () => {
  const model: ArchitectureModel = { version: 1, nodes: [node('a')], edges: [], groups: [] };
  const report = await verifyCodegen(process.cwd(), deltaAdding([node('a')]), model, opts);
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 0);
});
