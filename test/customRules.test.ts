import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileRules } from '../src/shared/rules/custom';
import { evaluateRules } from '../src/shared/rules/rules';
import type { ArchitectureModel } from '../src/shared/model/types';

const model: ArchitectureModel = {
  version: 1,
  nodes: [
    { id: 'web', name: 'Web', type: 'frontend', description: 'ui', position: { x: 0, y: 0 }, groupId: 'edge' },
    { id: 'db', name: 'DB', type: 'database', description: '', position: { x: 0, y: 0 }, groupId: 'data' },
  ],
  edges: [{ id: 'e', source: 'web', target: 'db', protocol: 'http' }],
  groups: [
    { id: 'edge', name: 'Edge' },
    { id: 'data', name: 'Data' },
  ],
};

test('forbidEdge rule flags a forbidden connection', () => {
  const rules = compileRules(
    'rules:\n  - id: no-fe-db\n    severity: error\n    forbidEdge: { fromType: frontend, toType: database }',
  );
  const violations = evaluateRules(model, rules);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, 'no-fe-db');
  assert.equal(violations[0].severity, 'error');
});

test('requireField rule flags a missing field', () => {
  const rules = compileRules('rules:\n  - id: need-desc\n    requireField: description');
  const violations = evaluateRules(model, rules).filter((v) => v.ruleId === 'need-desc');
  assert.equal(violations.length, 1); // db has empty description
  assert.equal(violations[0].nodeId, 'db');
});

test('forbidCrossContextEdge flags edges across bounded contexts', () => {
  const rules = compileRules(
    'rules:\n  - id: no-cross-db\n    severity: error\n    forbidCrossContextEdge: { toType: database }',
  );
  const violations = evaluateRules(model, rules).filter((v) => v.ruleId === 'no-cross-db');
  assert.equal(violations.length, 1); // web (edge) -> db (data) crosses contexts
});

test('ignores malformed rule config gracefully', () => {
  assert.deepEqual(compileRules('not: valid: yaml: ['), []);
  assert.deepEqual(compileRules('rules:\n  - severity: error'), []); // no id
});
