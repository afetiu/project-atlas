/**
 * Graph metrics over the architecture model — the quantitative half of Atlas's
 * "architecture intelligence". Pure functions of the model so they run in the
 * webview, the host, and the `atlas check` CLI alike.
 *
 * Definitions follow the usual package-coupling vocabulary, applied to
 * components:
 *   - afferent coupling (Ca) = fan-in  = how many components depend on this one,
 *   - efferent coupling (Ce) = fan-out = how many components this one depends on,
 *   - instability I = Ce / (Ca + Ce) ∈ [0,1]; 0 = maximally stable (only depended
 *     upon), 1 = maximally unstable (only depends on others).
 */

import type { ArchitectureModel } from './types';

export interface NodeMetrics {
  id: string;
  /** Distinct components that depend on this one (incoming edges). */
  fanIn: number;
  /** Distinct components this one depends on (outgoing edges). */
  fanOut: number;
  /** fanIn + fanOut. */
  degree: number;
  /** Ce / (Ca + Ce); undefined for a fully isolated component. */
  instability?: number;
}

export interface ModelMetrics {
  byNode: Map<string, NodeMetrics>;
  nodeCount: number;
  edgeCount: number;
  /** Components with no inbound or outbound edges. */
  isolatedCount: number;
  /** Fraction of code-mappable components that have a mapping path, 0–1. */
  mappingCoverage: number;
  /** Highest fan-out in the graph, with the owning node id. */
  maxFanOut: { id: string; value: number } | null;
}

/** Compute per-node coupling metrics and a model-level summary. */
export function computeMetrics(model: ArchitectureModel): ModelMetrics {
  const byNode = new Map<string, NodeMetrics>();
  for (const node of model.nodes) {
    byNode.set(node.id, { id: node.id, fanIn: 0, fanOut: 0, degree: 0 });
  }

  // Count *distinct* neighbours per direction so parallel edges don't inflate.
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    if (edge.source === edge.target) {
      continue;
    }
    if (!byNode.has(edge.source) || !byNode.has(edge.target)) {
      continue;
    }
    (out.get(edge.source) ?? out.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (inc.get(edge.target) ?? inc.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }

  let isolatedCount = 0;
  let maxFanOut: { id: string; value: number } | null = null;
  for (const m of byNode.values()) {
    m.fanOut = out.get(m.id)?.size ?? 0;
    m.fanIn = inc.get(m.id)?.size ?? 0;
    m.degree = m.fanIn + m.fanOut;
    if (m.degree === 0) {
      isolatedCount += 1;
    } else {
      m.instability = m.fanOut / (m.fanIn + m.fanOut);
    }
    if (!maxFanOut || m.fanOut > maxFanOut.value) {
      maxFanOut = { id: m.id, value: m.fanOut };
    }
  }

  const mappable = model.nodes.filter((n) => n.type !== 'externalApi');
  const mapped = mappable.filter((n) => !!n.mapping?.path).length;
  const mappingCoverage = mappable.length === 0 ? 1 : mapped / mappable.length;

  return {
    byNode,
    nodeCount: model.nodes.length,
    edgeCount: model.edges.length,
    isolatedCount,
    mappingCoverage,
    maxFanOut: maxFanOut && maxFanOut.value > 0 ? maxFanOut : null,
  };
}

/**
 * Find dependency cycles among nodes: every strongly-connected component with
 * more than one node, plus any explicit self-loop. Returns each cycle as a list
 * of node ids in a stable (input) order. Uses Tarjan's SCC algorithm.
 */
export function detectCycles(model: ArchitectureModel): string[][] {
  const ids = model.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const selfLoops: string[][] = [];
  for (const edge of model.edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) {
      continue;
    }
    if (edge.source === edge.target) {
      selfLoops.push([edge.source]);
      continue;
    }
    adj.get(edge.source)!.push(edge.target);
  }

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) {
        sccs.push(component);
      }
    }
  };

  for (const id of ids) {
    if (!idx.has(id)) {
      strongconnect(id);
    }
  }

  // Order each cycle's members by the model's node order for stable output.
  const order = new Map(ids.map((id, i) => [id, i]));
  const ordered = sccs.map((c) => [...c].sort((a, b) => order.get(a)! - order.get(b)!));
  return [...ordered, ...selfLoops];
}

/**
 * Find cycles among bounded contexts: collapse the graph so each node maps to
 * its context (ungrouped nodes are their own singleton), then detect cycles on
 * the contexts. A cycle here means two domains mutually depend on each other —
 * a coupling smell worth surfacing even when no single component cycles.
 */
export function detectContextCycles(model: ArchitectureModel): string[][] {
  const groupOf = new Map(model.nodes.map((n) => [n.id, n.groupId]));
  const realGroups = new Set(model.groups.map((g) => g.id));
  // Only consider edges that cross two *named* contexts.
  const contextEdges = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    const a = groupOf.get(edge.source);
    const b = groupOf.get(edge.target);
    if (!a || !b || a === b || !realGroups.has(a) || !realGroups.has(b)) {
      continue;
    }
    (contextEdges.get(a) ?? contextEdges.set(a, new Set()).get(a)!).add(b);
  }
  const pseudoModel: ArchitectureModel = {
    version: model.version,
    nodes: model.groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: 'service' as const,
      description: '',
      position: { x: 0, y: 0 },
    })),
    edges: [...contextEdges.entries()].flatMap(([a, targets]) =>
      [...targets].map((b) => ({ id: `${a}->${b}`, source: a, target: b, protocol: 'http' as const })),
    ),
    groups: [],
  };
  return detectCycles(pseudoModel);
}
