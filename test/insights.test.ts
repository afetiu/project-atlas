import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeMetrics, detectCycles, detectContextCycles } from '../src/shared/model/metrics';
import { analyzeArchitecture } from '../src/shared/model/insights';
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
  groups: ArchitectureModel['groups'] = [],
): ArchitectureModel => ({ version: 1, nodes, edges, groups });

test('computeMetrics: fan-in / fan-out / instability', () => {
  const m = computeMetrics(model([n('a'), n('b'), n('c')], [e('a', 'b'), e('a', 'c'), e('b', 'c')]));
  const a = m.byNode.get('a')!;
  const c = m.byNode.get('c')!;
  assert.equal(a.fanOut, 2);
  assert.equal(a.fanIn, 0);
  assert.equal(a.instability, 1); // depends on others, nothing depends on it
  assert.equal(c.fanIn, 2);
  assert.equal(c.fanOut, 0);
  assert.equal(c.instability, 0); // only depended upon → maximally stable
  assert.equal(m.maxFanOut?.id, 'a');
});

test('computeMetrics: distinct neighbours, ignores parallel/self edges', () => {
  const m = computeMetrics(model([n('a'), n('b')], [e('a', 'b'), e('a', 'b'), e('a', 'a')]));
  assert.equal(m.byNode.get('a')!.fanOut, 1);
  assert.equal(m.isolatedCount, 0);
});

test('computeMetrics: mapping coverage excludes external APIs', () => {
  const m = computeMetrics(
    model([
      n('a', 'service', { mapping: { path: 'svc/a' } }),
      n('b', 'service'),
      n('x', 'externalApi'),
    ]),
  );
  // 1 of 2 mappable nodes mapped → 0.5; the external API doesn't count.
  assert.equal(m.mappingCoverage, 0.5);
});

test('detectCycles: finds a multi-node cycle', () => {
  const cycles = detectCycles(model([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c'), e('c', 'a')]));
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].sort(), ['a', 'b', 'c']);
});

test('detectCycles: acyclic graph has none', () => {
  assert.equal(detectCycles(model([n('a'), n('b')], [e('a', 'b')])).length, 0);
});

test('detectContextCycles: mutually dependent contexts', () => {
  const m = model(
    [n('a', 'service', { groupId: 'g1' }), n('b', 'service', { groupId: 'g2' })],
    [e('a', 'b'), e('b', 'a')],
    [
      { id: 'g1', name: 'Orders' },
      { id: 'g2', name: 'Billing' },
    ],
  );
  const cycles = detectContextCycles(m);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].sort(), ['g1', 'g2']);
});

test('analyzeArchitecture: clean graph scores A', () => {
  const report = analyzeArchitecture(
    model(
      [
        n('web', 'frontend', { mapping: { path: 'apps/web' } }),
        n('api', 'service', { mapping: { path: 'svc/api' } }),
        n('db', 'database', { mapping: { path: 'svc/db' } }),
      ],
      [e('web', 'api'), e('api', 'db')],
    ),
  );
  assert.equal(report.grade, 'A');
  assert.equal(report.insights.length, 0);
});

test('analyzeArchitecture: cycle is critical and tanks the score', () => {
  const report = analyzeArchitecture(model([n('a'), n('b')], [e('a', 'b'), e('b', 'a')]));
  assert.ok(report.insights.some((i) => i.kind === 'dependency-cycle' && i.severity === 'critical'));
  assert.ok(report.score < 90);
});

test('analyzeArchitecture: layering violation when a datastore depends upward', () => {
  const report = analyzeArchitecture(
    model([n('db', 'database'), n('api', 'service')], [e('db', 'api')]),
  );
  assert.ok(report.insights.some((i) => i.kind === 'layering-violation'));
});

test('analyzeArchitecture: over-coupled component flagged', () => {
  const deps = ['b', 'c', 'd', 'e', 'f', 'g'];
  const report = analyzeArchitecture(
    model([n('a'), ...deps.map((d) => n(d))], deps.map((d) => e('a', d))),
  );
  const oc = report.insights.find((i) => i.kind === 'over-coupled');
  assert.ok(oc);
  assert.deepEqual(oc.nodeIds, ['a']);
});
