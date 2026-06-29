import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRules, topSeverity } from '../src/shared/rules/rules';
import type { ArchitectureModel } from '../src/shared/model/types';

const node = (id: string, over: Partial<ArchitectureModel['nodes'][number]> = {}) => ({
  id,
  name: id,
  type: 'service' as const,
  description: '',
  position: { x: 0, y: 0 },
  ...over,
});

function model(
  nodes: ArchitectureModel['nodes'],
  edges: ArchitectureModel['edges'] = [],
): ArchitectureModel {
  return { version: 1, nodes, edges, groups: [] };
}

test('flags a frontend connecting directly to a database', () => {
  const m = model(
    [node('web', { type: 'frontend', mapping: { path: 'a' } }), node('db', { type: 'database', mapping: { path: 'b' } })],
    [{ id: 'e', source: 'web', target: 'db', protocol: 'http' }],
  );
  const violations = evaluateRules(m);
  assert.ok(violations.some((v) => v.ruleId === 'frontend-direct-data' && v.edgeId === 'e'));
});

test('flags components without a code mapping (except external APIs)', () => {
  const m = model([
    node('svc', { mapping: { path: 'src/svc' } }),
    node('other'),
    node('ext', { type: 'externalApi' }),
  ]);
  const ids = evaluateRules(m)
    .filter((v) => v.ruleId === 'missing-mapping')
    .map((v) => v.nodeId);
  assert.deepEqual(ids, ['other']);
});

test('flags orphaned nodes only when there is more than one', () => {
  const connected = model(
    [node('a', { mapping: { path: 'a' } }), node('b', { mapping: { path: 'b' } })],
    [{ id: 'e', source: 'a', target: 'b', protocol: 'http' }],
  );
  assert.equal(
    evaluateRules(connected).filter((v) => v.ruleId === 'orphaned-node').length,
    0,
  );

  const orphan = model([
    node('a', { mapping: { path: 'a' } }),
    node('b', { mapping: { path: 'b' } }),
  ]);
  const orphanIds = evaluateRules(orphan)
    .filter((v) => v.ruleId === 'orphaned-node')
    .map((v) => v.nodeId)
    .sort();
  assert.deepEqual(orphanIds, ['a', 'b']);
});

test('topSeverity returns the most severe', () => {
  assert.equal(topSeverity([{ ruleId: 'x', severity: 'info', message: '' }, { ruleId: 'y', severity: 'warning', message: '' }]), 'warning');
  assert.equal(topSeverity([]), undefined);
});
