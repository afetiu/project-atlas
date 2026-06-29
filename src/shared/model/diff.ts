/**
 * Semantic diffing between two architecture models.
 *
 * This is what turns "the user rearranged the canvas" into "here is the
 * code-relevant change". Pure layout moves (position only) are deliberately
 * ignored — they carry no architectural meaning and must never trigger code
 * generation. Everything else (new/removed components, retyped or remapped
 * nodes, new/removed connections) becomes an actionable delta.
 */

import type {
  ArchitectureEdge,
  ArchitectureGroup,
  ArchitectureModel,
  ArchitectureNode,
} from './types';

export type NodeChangeKind = 'name' | 'type' | 'description' | 'mapping' | 'group';

export interface UpdatedNode {
  before: ArchitectureNode;
  after: ArchitectureNode;
  changes: NodeChangeKind[];
}

export interface UpdatedEdge {
  before: ArchitectureEdge;
  after: ArchitectureEdge;
}

export interface ModelDelta {
  addedNodes: ArchitectureNode[];
  removedNodes: ArchitectureNode[];
  updatedNodes: UpdatedNode[];
  addedEdges: ArchitectureEdge[];
  removedEdges: ArchitectureEdge[];
  updatedEdges: UpdatedEdge[];
  addedGroups: ArchitectureGroup[];
  removedGroups: ArchitectureGroup[];
}

export function diffModels(base: ArchitectureModel, next: ArchitectureModel): ModelDelta {
  const baseNodes = indexBy(base.nodes, (n) => n.id);
  const nextNodes = indexBy(next.nodes, (n) => n.id);

  const addedNodes = next.nodes.filter((n) => !baseNodes.has(n.id));
  const removedNodes = base.nodes.filter((n) => !nextNodes.has(n.id));
  const updatedNodes: UpdatedNode[] = [];
  for (const after of next.nodes) {
    const before = baseNodes.get(after.id);
    if (!before) {
      continue;
    }
    const changes = nodeChanges(before, after);
    if (changes.length > 0) {
      updatedNodes.push({ before, after, changes });
    }
  }

  const baseEdges = indexBy(base.edges, (e) => e.id);
  const nextEdges = indexBy(next.edges, (e) => e.id);

  const addedEdges = next.edges.filter((e) => !baseEdges.has(e.id));
  const removedEdges = base.edges.filter((e) => !nextEdges.has(e.id));
  const updatedEdges: UpdatedEdge[] = [];
  for (const after of next.edges) {
    const before = baseEdges.get(after.id);
    if (before && before.protocol !== after.protocol) {
      updatedEdges.push({ before, after });
    }
  }

  const baseGroups = indexBy(base.groups, (g) => g.id);
  const nextGroups = indexBy(next.groups, (g) => g.id);
  const addedGroups = next.groups.filter((g) => !baseGroups.has(g.id));
  const removedGroups = base.groups.filter((g) => !nextGroups.has(g.id));

  return {
    addedNodes,
    removedNodes,
    updatedNodes,
    addedEdges,
    removedEdges,
    updatedEdges,
    addedGroups,
    removedGroups,
  };
}

export function isEmptyDelta(delta: ModelDelta): boolean {
  return (
    delta.addedNodes.length === 0 &&
    delta.removedNodes.length === 0 &&
    delta.updatedNodes.length === 0 &&
    delta.addedEdges.length === 0 &&
    delta.removedEdges.length === 0 &&
    delta.updatedEdges.length === 0 &&
    delta.addedGroups.length === 0 &&
    delta.removedGroups.length === 0
  );
}

/** Render the delta as human-readable bullet lines for prompts and review UI. */
export function summarizeDelta(delta: ModelDelta): string[] {
  const lines: string[] = [];
  for (const node of delta.addedNodes) {
    lines.push(`Add ${node.type} "${node.name}" (${node.id})`);
  }
  for (const node of delta.removedNodes) {
    lines.push(`Remove ${node.type} "${node.name}" (${node.id})`);
  }
  for (const { after, changes } of delta.updatedNodes) {
    lines.push(`Update "${after.name}" (${after.id}): ${changes.join(', ')}`);
  }
  for (const edge of delta.addedEdges) {
    lines.push(`Connect ${edge.source} → ${edge.target} via ${edge.protocol}`);
  }
  for (const edge of delta.removedEdges) {
    lines.push(`Disconnect ${edge.source} → ${edge.target}`);
  }
  for (const { after } of delta.updatedEdges) {
    lines.push(`Change protocol of ${after.source} → ${after.target} to ${after.protocol}`);
  }
  for (const group of delta.addedGroups) {
    lines.push(`Add bounded context "${group.name}" (${group.id})`);
  }
  for (const group of delta.removedGroups) {
    lines.push(`Remove bounded context "${group.name}" (${group.id})`);
  }
  return lines;
}

function nodeChanges(before: ArchitectureNode, after: ArchitectureNode): NodeChangeKind[] {
  const changes: NodeChangeKind[] = [];
  if (before.name !== after.name) changes.push('name');
  if (before.type !== after.type) changes.push('type');
  if (before.description !== after.description) changes.push('description');
  if (JSON.stringify(before.mapping ?? {}) !== JSON.stringify(after.mapping ?? {})) {
    changes.push('mapping');
  }
  if ((before.groupId ?? '') !== (after.groupId ?? '')) {
    changes.push('group');
  }
  return changes;
}

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return map;
}
