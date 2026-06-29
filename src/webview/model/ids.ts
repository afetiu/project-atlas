/**
 * Deterministic, collision-free id generation for nodes and edges.
 *
 * Ids are derived from human-readable names where possible (so `atlas.yaml`
 * stays readable) and de-duplicated against the current model to guarantee the
 * "no duplicate IDs" invariant before a change ever reaches validation.
 */

import type { ArchitectureModel } from '../../shared/model/types';

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

export function makeUniqueNodeId(model: ArchitectureModel, baseName: string): string {
  const base = slugify(baseName);
  const existing = new Set(model.nodes.map((node) => node.id));
  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

export function makeEdgeId(model: ArchitectureModel, source: string, target: string): string {
  const existing = new Set(model.edges.map((edge) => edge.id));
  const base = `edge-${source}-${target}`;
  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}
