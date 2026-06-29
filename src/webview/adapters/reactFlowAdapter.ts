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
  ArchitectureModel,
  ArchitectureNode,
} from '../../shared/model/types';

/** Custom node type key registered with React Flow. */
export const ARCHITECTURE_NODE_TYPE = 'architecture';

export interface ArchitectureNodeData {
  node: ArchitectureNode;
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
