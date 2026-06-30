import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TEMPLATES, getTemplate } from '../src/shared/templates/templates';
import { validateModel } from '../src/shared/serialization/validation';
import { analyzeArchitecture } from '../src/shared/model/insights';

test('every template builds a valid, healthy, laid-out model', () => {
  assert.ok(TEMPLATES.length >= 4);
  for (const template of TEMPLATES) {
    const model = template.build();
    const result = validateModel(model);
    assert.equal(result.valid, true, `${template.id} should be valid: ${JSON.stringify(result.issues)}`);
    assert.ok(model.nodes.length > 0, `${template.id} has nodes`);
    assert.ok(model.groups.length > 0, `${template.id} has contexts`);
    // Templates are exemplary, so they should not ship structural smells.
    const report = analyzeArchitecture(model);
    assert.ok(
      report.insights.every((i) => i.severity !== 'critical'),
      `${template.id} should have no critical findings`,
    );
    // Auto-layout assigned real positions (not all at the origin).
    assert.ok(model.nodes.some((n) => n.position.x !== 0 || n.position.y !== 0));
  }
});

test('getTemplate resolves by id', () => {
  assert.equal(getTemplate('microservices')?.name, 'Microservices');
  assert.equal(getTemplate('nope'), undefined);
});
