/**
 * Translation layer between the domain model and React Flow's data structures.
 *
 * The domain model never imports React Flow, and React Flow types never leak
 * into the domain. This adapter is the only seam where the two meet, which
 * keeps the canvas library swappable in the future.
 */

import { MarkerType, type Edge, type Node } from 'reactflow';

import type { OverlayTone } from '../../shared/model/lenses';
import { getProtocolLabel } from '../../shared/model/protocols';
import type {
  ArchitectureEdge,
  ArchitectureGroup,
  ArchitectureModel,
  ArchitectureNode,
} from '../../shared/model/types';
import type { RuleSeverity } from '../../shared/rules/rules';

/** Custom node/edge type keys registered with React Flow. */
export const ARCHITECTURE_NODE_TYPE = 'architecture';
export const ARCHITECTURE_GROUP_TYPE = 'group';
export const ARCHITECTURE_COLLAPSED_TYPE = 'collapsedGroup';
export const ARCHITECTURE_EDGE_TYPE = 'floating';

/** React Flow node ids are prefixed so region/collapsed nodes never collide with node ids. */
export const GROUP_ID_PREFIX = 'group:';
export const COLLAPSED_ID_PREFIX = 'collapsed:';

// Component cards render at a *fixed* size (see `.atlas-node` in atlas.css), so
// region bounds and the map layout can share exact geometry instead of guessing.
// If the CSS card size changes, change it here and in shared/model/mapLayout.ts.
export const CARD_W = 230;
export const CARD_H = 64;
const NODE_W = CARD_W;
const NODE_H = CARD_H;
const PAD_X = 34;
const PAD_TOP = 48;

export interface ArchitectureNodeData {
  node: ArchitectureNode;
  /** Highest severity of any rule violation on this node, for the badge. */
  issueSeverity?: RuleSeverity;
  /** Code under this component's mapping changed since the last detection. */
  drifted?: boolean;
  /** Semantic tone from the active map lens (recolours the node). */
  overlayTone?: OverlayTone;
}

export interface ArchitectureGroupData {
  group: ArchitectureGroup;
  memberCount: number;
}

export interface ArchitectureEdgeData {
  protocol: ArchitectureEdge['protocol'];
  /** Road "traffic" weight (1–3) under the coupling lens. */
  weight?: number;
  /** Hover state, threaded to the portaled label (classes can't reach it). */
  dim?: boolean;
  hl?: boolean;
}

export type FlowNode = Node<ArchitectureNodeData>;
export type FlowEdge = Edge<ArchitectureEdgeData>;

export function toFlowNodes(
  model: ArchitectureModel,
  collapsed: ReadonlySet<string> = EMPTY_SET,
): FlowNode[] {
  return model.nodes
    .filter((node) => !(node.groupId && collapsed.has(node.groupId)))
    .map((node) => ({
      id: node.id,
      type: ARCHITECTURE_NODE_TYPE,
      position: node.position,
      data: { node },
    }));
}

/** One compact node per collapsed bounded context, standing in for its members. */
export function toCollapsedGroupNodes(
  model: ArchitectureModel,
  collapsed: ReadonlySet<string>,
): FlowGroupNode[] {
  const nodes: FlowGroupNode[] = [];
  model.groups.forEach((group, index) => {
    if (!collapsed.has(group.id)) {
      return;
    }
    const members = model.nodes.filter((node) => node.groupId === group.id);
    const bounds = members.length > 0 ? boundsOf(members) : defaultBounds(index);
    nodes.push({
      id: `${COLLAPSED_ID_PREFIX}${group.id}`,
      type: ARCHITECTURE_COLLAPSED_TYPE,
      position: { x: bounds.x, y: bounds.y },
      data: { group, memberCount: members.length },
    });
  });
  return nodes;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export type FlowGroupNode = Node<ArchitectureGroupData>;

/**
 * Build a background region for each bounded context, auto-fitted to the bounds
 * of its member components. Groups with no members get a default-sized box so
 * they remain visible and selectable.
 */
export function toFlowGroups(
  model: ArchitectureModel,
  collapsed: ReadonlySet<string> = EMPTY_SET,
): FlowGroupNode[] {
  return model.groups
    .filter((group) => !collapsed.has(group.id))
    .map((group, index) => {
    const members = model.nodes.filter((node) => node.groupId === group.id);
    const bounds = members.length > 0 ? boundsOf(members) : defaultBounds(index);
    return {
      id: `${GROUP_ID_PREFIX}${group.id}`,
      type: ARCHITECTURE_GROUP_TYPE,
      position: { x: bounds.x, y: bounds.y },
      data: { group, memberCount: members.length },
      draggable: false,
      connectable: false,
      selectable: true,
      // Groups render behind components; they are listed first in the array.
      style: { width: bounds.width, height: bounds.height },
    };
  });
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Region bounds per group id, for hit-testing drag-into-group. */
export function groupBounds(model: ArchitectureModel): Map<string, Bounds> {
  const result = new Map<string, Bounds>();
  model.groups.forEach((group, index) => {
    const members = model.nodes.filter((node) => node.groupId === group.id);
    result.set(group.id, members.length > 0 ? boundsOf(members) : defaultBounds(index));
  });
  return result;
}

function boundsOf(members: ArchitectureNode[]): Bounds {
  const xs = members.map((m) => m.position.x);
  const ys = members.map((m) => m.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs) + NODE_W;
  const maxY = Math.max(...ys) + NODE_H;
  return {
    x: minX - PAD_X,
    y: minY - PAD_TOP,
    width: maxX - minX + PAD_X * 2,
    height: maxY - minY + PAD_TOP + PAD_X,
  };
}

function defaultBounds(index: number) {
  return { x: 40 + index * 28, y: 40 + index * 28, width: 300, height: 170 };
}

export function toFlowEdges(
  model: ArchitectureModel,
  collapsed: ReadonlySet<string> = EMPTY_SET,
): FlowEdge[] {
  const groupOf = new Map(model.nodes.map((n) => [n.id, n.groupId]));
  const endpoint = (nodeId: string): string => {
    const groupId = groupOf.get(nodeId);
    return groupId && collapsed.has(groupId) ? `${COLLAPSED_ID_PREFIX}${groupId}` : nodeId;
  };

  const seen = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const edge of model.edges) {
    const source = endpoint(edge.source);
    const target = endpoint(edge.target);
    if (source === target) {
      continue; // wholly inside one collapsed context
    }
    const key = `${source}->${target}`;
    if (seen.has(key)) {
      continue; // multiple member edges collapse to one
    }
    seen.add(key);
    edges.push({
      id: edge.id,
      source,
      target,
      type: ARCHITECTURE_EDGE_TYPE,
      label: getProtocolLabel(edge.protocol),
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#6a7694' },
      data: { protocol: edge.protocol },
    });
  }
  return edges;
}
