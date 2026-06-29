import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AtlasParseError,
  deserializeModel,
  serializeModel,
} from '../src/shared/serialization/yaml';
import { createEmptyModel, type ArchitectureModel } from '../src/shared/model/types';

const sample: ArchitectureModel = {
  version: 1,
  nodes: [
    {
      id: 'web',
      name: 'Web',
      type: 'frontend',
      description: 'UI',
      position: { x: 1.234, y: 2 },
      mapping: { path: 'apps/web', language: 'typescript' },
    },
    {
      id: 'api',
      name: 'API',
      type: 'service',
      description: '',
      position: { x: 10, y: 20 },
      groupId: 'core',
    },
  ],
  edges: [{ id: 'e1', source: 'web', target: 'api', protocol: 'http' }],
  groups: [{ id: 'core', name: 'Core', color: '#7c93ff' }],
};

test('round-trips nodes, edges, mapping, and groups', () => {
  const back = deserializeModel(serializeModel(sample));
  assert.equal(back.nodes.length, 2);
  assert.equal(back.edges.length, 1);
  assert.deepEqual(back.nodes[0].mapping, { path: 'apps/web', language: 'typescript' });
  assert.equal(back.nodes[1].groupId, 'core');
  assert.deepEqual(back.groups, [{ id: 'core', name: 'Core', color: '#7c93ff' }]);
});

test('rounds positions to two decimals', () => {
  const back = deserializeModel(serializeModel(sample));
  assert.equal(back.nodes[0].position.x, 1.23);
});

test('omits empty mapping from output', () => {
  const text = serializeModel(sample);
  // The api node has no mapping; ensure we did not emit an empty mapping block.
  assert.equal(text.includes('mapping: {}'), false);
});

test('empty text yields an empty model', () => {
  assert.deepEqual(deserializeModel('   '), createEmptyModel());
});

test('invalid YAML throws AtlasParseError', () => {
  assert.throws(() => deserializeModel('foo: ]['), AtlasParseError);
});

test('coerces unknown type and protocol to defaults', () => {
  const model = deserializeModel(
    'nodes:\n  - id: a\n    type: nope\nedges:\n  - id: e\n    source: a\n    target: a\n    protocol: smoke',
  );
  assert.equal(model.nodes[0].type, 'service');
  assert.equal(model.edges[0].protocol, 'http');
});
