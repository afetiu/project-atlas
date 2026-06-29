/**
 * Deterministic layered auto-layout.
 *
 * AI detection returns components and connections but no coordinates. Rather
 * than pull in a heavyweight graph-layout dependency, we compute a simple,
 * stable left-to-right layered layout: roots (no inbound edges) on the left,
 * dependents flowing rightward. Deterministic output keeps `atlas.yaml` diffs
 * clean when re-running detection.
 */

import type { ArchitectureEdge, ArchitectureNode, Position } from './types';

const COLUMN_GAP = 320;
const ROW_GAP = 140;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

export function computeLayout(
  nodes: Pick<ArchitectureNode, 'id'>[],
  edges: Pick<ArchitectureEdge, 'source' | 'target'>[],
): Map<string, Position> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, 0);
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target) || edge.source === edge.target) {
      continue;
    }
    adjacency.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  // Longest-path layering via Kahn's algorithm. Nodes left over (in cycles)
  // are appended to the deepest layer they were reached at.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  const remaining = new Map(incoming);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const currentLayer = layer.get(id)!;
    for (const next of adjacency.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, currentLayer + 1));
      remaining.set(next, (remaining.get(next) ?? 1) - 1);
      if ((remaining.get(next) ?? 0) <= 0) {
        queue.push(next);
      }
    }
  }

  // Group by layer, preserving input order for stable row assignment.
  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    const bucket = byLayer.get(l) ?? [];
    bucket.push(id);
    byLayer.set(l, bucket);
  }

  const positions = new Map<string, Position>();
  for (const [l, bucket] of byLayer) {
    bucket.forEach((id, row) => {
      positions.set(id, {
        x: ORIGIN_X + l * COLUMN_GAP,
        y: ORIGIN_Y + row * ROW_GAP,
      });
    });
  }
  return positions;
}
