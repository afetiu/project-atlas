import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyLayout,
  AtlasParseError,
  deserializeModel,
  serializeLayout,
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
  const web = back.nodes.find((n) => n.id === 'web')!;
  const api = back.nodes.find((n) => n.id === 'api')!;
  assert.deepEqual(web.mapping, { path: 'apps/web', language: 'typescript' });
  assert.equal(api.groupId, 'core');
  assert.deepEqual(back.groups, [{ id: 'core', name: 'Core', color: '#7c93ff' }]);
});

test('positions live in the layout sidecar, not atlas.yaml', () => {
  const logical = serializeModel(sample);
  assert.equal(logical.includes('position'), false);
  // Layout round-trips (and rounds) through the sidecar.
  const merged = applyLayout(deserializeModel(logical), serializeLayout(sample));
  assert.equal(merged.nodes.find((n) => n.id === 'web')!.position.x, 1.23);
});

test('logical entities are sorted by id (merge-clean)', () => {
  const model = {
    version: 1,
    nodes: [],
    edges: [],
    groups: [
      { id: 'zeta', name: 'Z' },
      { id: 'alpha', name: 'A' },
    ],
  } as never;
  const text = serializeModel(model);
  assert.ok(text.indexOf('alpha') < text.indexOf('zeta'));
});

test('omits empty mapping from output', () => {
  const text = serializeModel(sample);
  // The api node has no mapping; ensure we did not emit an empty mapping block.
  assert.equal(text.includes('mapping: {}'), false);
});

test('migrates an old file with inline positions (no sidecar yet)', () => {
  const old = [
    'version: 1',
    'nodes:',
    '  - id: a',
    '    type: service',
    '    position: { x: 42, y: 17 }',
    'edges: []',
    'groups: []',
  ].join('\n');
  // deserialize reads the inline position; applyLayout with no sidecar keeps it.
  const merged = applyLayout(deserializeModel(old), '');
  assert.deepEqual(merged.nodes[0].position, { x: 42, y: 17 });
});

test('empty text yields an empty model', () => {
  assert.deepEqual(deserializeModel('   '), createEmptyModel());
});

test('invalid YAML throws AtlasParseError', () => {
  assert.throws(() => deserializeModel('foo: ]['), AtlasParseError);
});

test('preserves unknown top-level and per-node keys across a round-trip', () => {
  const source = [
    'version: 1',
    'owner: platform-team', // unknown top-level key
    'nodes:',
    '  - id: a',
    '    type: service',
    '    sla: 99.9', // unknown per-node key
    'edges: []',
    'groups: []',
  ].join('\n');
  const back = deserializeModel(serializeModel(deserializeModel(source)));
  assert.equal(back.extra?.owner, 'platform-team');
  assert.equal(back.nodes[0].extra?.sla, 99.9);
});

test('coerces unknown type and protocol to defaults', () => {
  const model = deserializeModel(
    'nodes:\n  - id: a\n    type: nope\nedges:\n  - id: e\n    source: a\n    target: a\n    protocol: smoke',
  );
  assert.equal(model.nodes[0].type, 'service');
  assert.equal(model.edges[0].protocol, 'http');
});

test('extra fields can never shadow a canonical key on serialize', () => {
  // A node whose `extra` carries a key that collides with a real field must not
  // be able to overwrite that field when written back out.
  const model: ArchitectureModel = {
    version: 1,
    nodes: [
      {
        id: 'a',
        name: 'A',
        type: 'service',
        description: '',
        position: { x: 0, y: 0 },
        extra: { type: 'database', id: 'evil' },
      },
    ],
    edges: [],
    groups: [],
  };
  const back = deserializeModel(serializeModel(model));
  assert.equal(back.nodes[0].id, 'a');
  assert.equal(back.nodes[0].type, 'service');
});
