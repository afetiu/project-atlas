import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderPrComment, PR_COMMENT_MARKER } from '../src/cli/diff';
import type { ArchitectureModel } from '../src/shared/model/types';

const n = (id: string, type: ArchitectureModel['nodes'][number]['type'] = 'service') => ({
  id,
  name: id,
  type,
  description: '',
  position: { x: 0, y: 0 },
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

test('comment carries the sticky marker for in-place updates', () => {
  const body = renderPrComment(model([n('a')]), model([n('a')]));
  assert.ok(body.startsWith(PR_COMMENT_MARKER));
});

test('no changes reads as no changes', () => {
  const m = model([n('a'), n('b')], [e('a', 'b')]);
  assert.ok(renderPrComment(m, m).includes('No architecture changes'));
});

test('added/removed components are bucketed', () => {
  const base = model([n('a')]);
  const head = model([n('a'), n('b')], [e('a', 'b')]);
  const body = renderPrComment(base, head);
  assert.ok(/\*\*Added\*\*/.test(body));
  assert.ok(/Add service "b"/.test(body));
  assert.ok(/Connect a → b/.test(body));
});

test('surfaces a health regression and critical findings', () => {
  const base = model([n('a'), n('b')], [e('a', 'b')]); // acyclic
  const head = model([n('a'), n('b')], [e('a', 'b'), e('b', 'a')]); // cycle introduced
  const body = renderPrComment(base, head);
  assert.ok(/\*\*Health:\*\*/.test(body));
  assert.ok(/Critical findings/.test(body));
});
