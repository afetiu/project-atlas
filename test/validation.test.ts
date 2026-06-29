import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateModel } from '../src/shared/serialization/validation';
import { createEmptyModel, type ArchitectureModel } from '../src/shared/model/types';

test('empty model is valid', () => {
  assert.equal(validateModel(createEmptyModel()).valid, true);
});

test('detects duplicate node ids', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [
      { id: 'a', name: 'A', type: 'service', description: '', position: { x: 0, y: 0 } },
      { id: 'a', name: 'A2', type: 'service', description: '', position: { x: 0, y: 0 } },
    ],
    edges: [],
    groups: [],
  };
  const result = validateModel(model);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => /Duplicate node id/.test(i.message)));
});

test('detects broken edges', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [{ id: 'a', name: 'A', type: 'service', description: '', position: { x: 0, y: 0 } }],
    edges: [{ id: 'e', source: 'a', target: 'ghost', protocol: 'http' }],
    groups: [],
  };
  const result = validateModel(model);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => /missing target node/.test(i.message)));
});

test('unknown protocol is a warning, not an error', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [
      { id: 'a', name: 'A', type: 'service', description: '', position: { x: 0, y: 0 } },
      { id: 'b', name: 'B', type: 'service', description: '', position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', protocol: 'smoke' as never }],
    groups: [],
  };
  const result = validateModel(model);
  assert.equal(result.valid, true);
  assert.ok(result.issues.some((i) => i.severity === 'warning'));
});

test('detects duplicate group ids', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [],
    edges: [],
    groups: [
      { id: 'orders', name: 'Orders' },
      { id: 'orders', name: 'Orders 2' },
    ],
  };
  const result = validateModel(model);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => /Duplicate group id/.test(i.message)));
});

test('warns on a node referencing a missing group', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [
      { id: 'a', name: 'A', type: 'service', description: '', position: { x: 0, y: 0 }, groupId: 'ghost' },
    ],
    edges: [],
    groups: [],
  };
  const result = validateModel(model);
  assert.equal(result.valid, true);
  assert.ok(result.issues.some((i) => /missing group/.test(i.message)));
});
