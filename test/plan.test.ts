import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assessPlan,
  blastRadius,
  deserializePlan,
  planFileName,
  renderAdr,
  serializePlan,
  type Plan,
} from '../src/shared/plans/plan';
import type { ArchitectureModel } from '../src/shared/model/types';
import type { NodeTypeId } from '../src/shared/model/nodeTypes';

const n = (id: string, type: NodeTypeId = 'service', over: Record<string, unknown> = {}) => ({
  id, name: id, type, description: '', position: { x: 10, y: 20 }, ...over,
});
const e = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t, protocol: 'http' as const });
const model = (
  nodes: ArchitectureModel['nodes'],
  edges: ArchitectureModel['edges'] = [],
  groups: ArchitectureModel['groups'] = [],
): ArchitectureModel => ({ version: 1, nodes, edges, groups });

test('plan round-trips through YAML with positions intact', () => {
  const plan: Plan = {
    name: 'Extract payments',
    rationale: 'Isolate the payments domain.',
    status: 'draft',
    createdAt: '2026-07-07T10:00:00Z',
    target: model([n('a', 'service', { position: { x: 123, y: 456 } })]),
  };
  const back = deserializePlan(serializePlan(plan));
  assert.equal(back.name, 'Extract payments');
  assert.equal(back.status, 'draft');
  assert.deepEqual(back.target.nodes[0].position, { x: 123, y: 456 });
  assert.equal(planFileName(plan.name), 'extract-payments.yaml');
});

test('blastRadius walks transitive dependents, excluding the changed set', () => {
  // web -> gw -> orders -> db ; changing db ripples to orders, gw, web
  const m = model([n('web'), n('gw'), n('orders'), n('db')], [e('web', 'gw'), e('gw', 'orders'), e('orders', 'db')]);
  const blast = blastRadius(m, new Set(['db']));
  assert.deepEqual([...blast].sort(), ['gw', 'orders', 'web']);
  assert.equal(blast.has('db'), false);
});

test('assessPlan reports changes, blast, and health delta', () => {
  const base = model([n('web', 'frontend'), n('gw'), n('db', 'database')], [e('web', 'gw'), e('gw', 'db')]);
  // plan: insert a cache between gw and db + introduce a cycle gw<->web
  const target = model(
    [n('web', 'frontend'), n('gw'), n('db', 'database'), n('cache', 'cache')],
    [e('web', 'gw'), e('gw', 'cache'), e('cache', 'db'), e('gw', 'web')],
  );
  const a = assessPlan(base, target);
  assert.ok(a.changedNodeIds.includes('cache'));
  assert.ok(a.changes.some((c) => /Add cache "cache"/.test(c)));
  // gw is changed (edge endpoints); web depends on gw → blast unless itself changed.
  assert.ok(a.before.score !== a.after.score || a.introducedInsights.length > 0);
  assert.ok(a.introducedInsights.some((t) => /cycle/i.test(t)));
});

test('renderAdr produces a complete decision record', () => {
  const base = model([n('a'), n('b')], [e('a', 'b')]);
  const target = model([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c')]);
  const plan: Plan = {
    name: 'Add reporting service',
    rationale: 'We need async reporting.',
    status: 'draft',
    createdAt: '2026-07-07T10:00:00Z',
    target,
  };
  const adr = renderAdr({ number: 7, plan, base, assessment: assessPlan(base, target) });
  assert.ok(adr.startsWith('# ADR-007: Add reporting service'));
  assert.ok(adr.includes('- Status: accepted'));
  assert.ok(adr.includes('We need async reporting.'));
  assert.ok(adr.includes('Add service "c"'));
  assert.ok(/Architecture health: [A-F] \d+\/100 → [A-F] \d+\/100/.test(adr));
  assert.ok(/Blast radius: 1 dependent component affected — a\./.test(adr));
});
