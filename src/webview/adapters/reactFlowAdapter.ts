/**
 * Translation layer between the domain model and React Flow's data structures.
 *
 * The domain model never imports React Flow, and React Flow types never leak
 * into the domain. This adapter is the only seam where the two meet, which
 * keeps the canvas library swappable in the future.
 */

import type { Edge, Node } from 'reactflow';

import { getProtocolLabel } from '../../shared/model/protocols';
import type {
  ArchitectureEdge,
  ArchitectureGroup,
  ArchitectureModel,
  ArchitectureNode,
} from '../../shared/model/types';
import type { RuleSeverity } from '../../shared/rules/rules';

/** Custom node type keys registered with React Flow. */
export const ARCHITECTURE_NODE_TYPE = 'architecture';
export const ARCHITECTURE_GROUP_TYPE = 'group';

/** React Flow node ids for group regions are prefixed to avoid colliding with node ids. */
export const GROUP_ID_PREFIX = 'group:';

// Approximate component card size, used to compute region bounds.
const NODE_W = 210;
const NODE_H = 60;
const PAD_X = 30;
const PAD_TOP = 46;

export interface ArchitectureNodeData {
  node: ArchitectureNode;
  /** Highest severity of any rule violation on this node, for the badge. */
  issueSeverity?: RuleSeverity;
}

export interface ArchitectureGroupData {
  group: ArchitectureGroup;
  memberCount: number;
}

export interface ArchitectureEdgeData {
  protocol: ArchitectureEdge['protocol'];
}

export type FlowNode = Node<ArchitectureNodeData>;
export type FlowEdge = Edge<ArchitectureEdgeData>;

export function toFlowNodes(model: ArchitectureModel): FlowNode[] {
  return model.nodes.map((node) => ({
    id: node.id,
    type: ARCHITECTURE_NODE_TYPE,
    position: node.position,
    data: { node },
  }));
}

export type FlowGroupNode = Node<ArchitectureGroupData>;

/**
 * Build a background region for each bounded context, auto-fitted to the bounds
 * of its member components. Groups with no members get a default-sized box so
 * they remain visible and selectable.
 */
export function toFlowGroups(model: ArchitectureModel): FlowGroupNode[] {
  return model.groups.map((group, index) => {
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

function boundsOf(members: ArchitectureNode[]) {
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

export function toFlowEdges(model: ArchitectureModel): FlowEdge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: getProtocolLabel(edge.protocol),
    data: { protocol: edge.protocol },
  }));
}
