import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectedToModel, type DetectedArchitecture } from '../src/shared/ai/detection';
import type { ArchitectureModel } from '../src/shared/model/types';

test('normalizes ids, types, protocols, and mapping', () => {
  const detected: DetectedArchitecture = {
    nodes: [
      { id: 'API Gateway', name: 'API Gateway', type: 'service', path: 'src/gw', language: 'go' },
      { id: 'Cache!!', name: 'Cache', type: 'nonsense' },
    ],
    edges: [{ source: 'API Gateway', target: 'Cache!!', protocol: 'whoknows' }],
  };
  const model = detectedToModel(detected);
  assert.equal(model.nodes[0].id, 'api-gateway');
  assert.equal(model.nodes[0].mapping?.path, 'src/gw');
  assert.equal(model.nodes[1].type, 'service'); // unknown coerced
  assert.equal(model.edges[0].protocol, 'http'); // unknown coerced
  assert.equal(model.edges[0].source, 'api-gateway');
});

test('deduplicates colliding ids', () => {
  const detected: DetectedArchitecture = {
    nodes: [
      { id: 'svc', name: 'A', type: 'service' },
      { id: 'svc', name: 'B', type: 'service' },
    ],
    edges: [],
  };
  const model = detectedToModel(detected);
  const ids = model.nodes.map((n) => n.id);
  assert.deepEqual(ids, ['svc', 'svc-2']);
});

test('drops edges referencing unknown nodes and self-loops', () => {
  const detected: DetectedArchitecture = {
    nodes: [{ id: 'a', name: 'A', type: 'service' }],
    edges: [
      { source: 'a', target: 'ghost', protocol: 'http' },
      { source: 'a', target: 'a', protocol: 'http' },
    ],
  };
  assert.equal(detectedToModel(detected).edges.length, 0);
});

test('assigns non-trivial positions via layout', () => {
  const detected: DetectedArchitecture = {
    nodes: [
      { id: 'a', name: 'A', type: 'service' },
      { id: 'b', name: 'B', type: 'service' },
    ],
    edges: [{ source: 'a', target: 'b', protocol: 'http' }],
  };
  const model = detectedToModel(detected);
  // b is downstream of a, so it should be in a later column (greater x).
  const a = model.nodes.find((n) => n.id === 'a')!;
  const b = model.nodes.find((n) => n.id === 'b')!;
  assert.ok(b.position.x > a.position.x);
});

test('builds bounded contexts from group names and assigns membership', () => {
  const detected: DetectedArchitecture = {
    nodes: [
      { id: 'a', name: 'A', type: 'service', group: 'Orders' },
      { id: 'b', name: 'B', type: 'database', group: 'Orders' },
      { id: 'c', name: 'C', type: 'service', group: 'Identity' },
      { id: 'd', name: 'D', type: 'service' },
    ],
    edges: [],
  };
  const model = detectedToModel(detected);
  assert.equal(model.groups.length, 2);
  const orders = model.groups.find((g) => g.name === 'Orders')!;
  assert.equal(model.nodes.filter((n) => n.groupId === orders.id).length, 2);
  assert.equal(model.nodes.find((n) => n.id === 'd')!.groupId, undefined);
  assert.ok(orders.color); // colour assigned
});

test('preserves existing positions when requested', () => {
  const previous: ArchitectureModel = {
    version: 1,
    nodes: [{ id: 'a', name: 'A', type: 'service', description: '', position: { x: 500, y: 600 } }],
    edges: [],
  };
  const detected: DetectedArchitecture = {
    nodes: [{ id: 'a', name: 'A', type: 'service' }],
    edges: [],
  };
  const model = detectedToModel(detected, { preservePositionsFrom: previous });
  assert.deepEqual(model.nodes[0].position, { x: 500, y: 600 });
});
