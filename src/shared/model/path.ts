/**
 * Path tracing between two components — "how does data get from A to B?"
 * BFS over the directed dependency graph; if no forward route exists, the
 * reverse direction is tried so the answer is still useful ("B reaches A").
 */

import type { ArchitectureModel } from './types';

export interface TracedPath {
  /** Node ids along the route, source first. */
  nodeIds: string[];
  /** Edge ids along the route, in travel order. */
  edgeIds: string[];
  /** True when the route runs target→source (no forward path existed). */
  reversed: boolean;
}

export function findPath(model: ArchitectureModel, from: string, to: string): TracedPath | null {
  const forward = bfs(model, from, to);
  if (forward) {
    return { ...forward, reversed: false };
  }
  const backward = bfs(model, to, from);
  if (backward) {
    return { ...backward, reversed: true };
  }
  return null;
}

function bfs(
  model: ArchitectureModel,
  start: string,
  goal: string,
): { nodeIds: string[]; edgeIds: string[] } | null {
  if (start === goal) {
    return null;
  }
  // adjacency: node -> outgoing (neighbour, edgeId)
  const out = new Map<string, Array<{ to: string; edgeId: string }>>();
  for (const edge of model.edges) {
    (out.get(edge.source) ?? out.set(edge.source, []).get(edge.source)!).push({
      to: edge.target,
      edgeId: edge.id,
    });
  }
  const cameFrom = new Map<string, { node: string; edgeId: string }>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of out.get(current) ?? []) {
      if (seen.has(step.to)) {
        continue;
      }
      seen.add(step.to);
      cameFrom.set(step.to, { node: current, edgeId: step.edgeId });
      if (step.to === goal) {
        // Reconstruct.
        const nodeIds = [goal];
        const edgeIds: string[] = [];
        let cursor = goal;
        while (cursor !== start) {
          const prev = cameFrom.get(cursor)!;
          edgeIds.unshift(prev.edgeId);
          nodeIds.unshift(prev.node);
          cursor = prev.node;
        }
        return { nodeIds, edgeIds };
      }
      queue.push(step.to);
    }
  }
  return null;
}
