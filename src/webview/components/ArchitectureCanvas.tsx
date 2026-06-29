/**
 * The architecture canvas — a controlled React Flow surface.
 *
 * React Flow is driven entirely from the domain model: nodes and edges are
 * derived from `model` on each render, and every interaction (move, connect,
 * delete, select, drop) is translated back into a model mutation. There is no
 * second source of truth for the graph inside the canvas.
 */

import React, { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  useReactFlow,
} from 'reactflow';

import { isNodeTypeId } from '../../shared/model/nodeTypes';
import type { RuleSeverity } from '../../shared/rules/rules';
import {
  ARCHITECTURE_COLLAPSED_TYPE,
  ARCHITECTURE_EDGE_TYPE,
  ARCHITECTURE_GROUP_TYPE,
  ARCHITECTURE_NODE_TYPE,
  COLLAPSED_ID_PREFIX,
  GROUP_ID_PREFIX,
  groupBounds,
  toCollapsedGroupNodes,
  toFlowEdges,
  toFlowGroups,
  toFlowNodes,
} from '../adapters/reactFlowAdapter';
import type { Node as FlowNodeType } from 'reactflow';
import type { ArchitectureModelApi } from '../model/useArchitectureModel';
import { ArchitectureNodeView } from './ArchitectureNodeView';
import { CanvasContext } from './canvasContext';
import { CollapsedGroupNode } from './CollapsedGroupNode';
import { FloatingEdge } from './FloatingEdge';
import { GroupRegion } from './GroupRegion';
import { PALETTE_DND_MIME } from './Palette';

export interface Selection {
  nodeId: string | null;
  edgeId: string | null;
  groupId: string | null;
}

interface ArchitectureCanvasProps {
  api: ArchitectureModelApi;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  issueByNode: Map<string, RuleSeverity>;
  onOpenFile: (path: string) => void;
  collapsedGroups: ReadonlySet<string>;
  onToggleCollapse: (groupId: string) => void;
}

const nodeTypes = {
  [ARCHITECTURE_NODE_TYPE]: ArchitectureNodeView,
  [ARCHITECTURE_GROUP_TYPE]: GroupRegion,
  [ARCHITECTURE_COLLAPSED_TYPE]: CollapsedGroupNode,
};

const edgeTypes = { [ARCHITECTURE_EDGE_TYPE]: FloatingEdge };

/** Extract the group id from a region or collapsed-group flow-node id. */
function groupIdOf(flowNodeId: string): string | null {
  if (flowNodeId.startsWith(GROUP_ID_PREFIX)) {
    return flowNodeId.slice(GROUP_ID_PREFIX.length);
  }
  if (flowNodeId.startsWith(COLLAPSED_ID_PREFIX)) {
    return flowNodeId.slice(COLLAPSED_ID_PREFIX.length);
  }
  return null;
}

export function ArchitectureCanvas({
  api,
  selection,
  onSelectionChange,
  issueByNode,
  onOpenFile,
  collapsedGroups,
  onToggleCollapse,
}: ArchitectureCanvasProps): JSX.Element {
  const { screenToFlowPosition } = useReactFlow();
  const { model, moveNodes, removeNodes, removeEdges, removeGroups, addEdge, addNode, setNodeGroup } =
    api;

  // Hovering a node highlights it and its direct neighbours, dimming the rest.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const baseEdges = useMemo(() => toFlowEdges(model, collapsedGroups), [model, collapsedGroups]);

  const neighborIds = useMemo(() => {
    if (!hoveredId) {
      return null;
    }
    const set = new Set<string>([hoveredId]);
    for (const edge of baseEdges) {
      if (edge.source === hoveredId) set.add(edge.target);
      if (edge.target === hoveredId) set.add(edge.source);
    }
    return set;
  }, [hoveredId, baseEdges]);

  // Derive React Flow state from the model, applying the current selection.
  // Group regions are listed first so they render behind the components.
  const nodes = useMemo(() => {
    const faded = (id: string) =>
      neighborIds && !neighborIds.has(id) ? 'atlas-faded' : undefined;
    const groupNodes = toFlowGroups(model, collapsedGroups).map((group) => ({
      ...group,
      selected: group.id === `${GROUP_ID_PREFIX}${selection.groupId}`,
    }));
    const collapsedNodes = toCollapsedGroupNodes(model, collapsedGroups).map((node) => ({
      ...node,
      draggable: false,
      selected: node.id === `${COLLAPSED_ID_PREFIX}${selection.groupId}`,
      className: faded(node.id),
    }));
    const flowNodes = toFlowNodes(model, collapsedGroups).map((node) => ({
      ...node,
      selected: node.id === selection.nodeId,
      className: faded(node.id),
      data: { ...node.data, issueSeverity: issueByNode.get(node.id) },
    }));
    return [...groupNodes, ...collapsedNodes, ...flowNodes];
  }, [model, selection.nodeId, selection.groupId, issueByNode, collapsedGroups, neighborIds]);

  const edges = useMemo(() => {
    return baseEdges.map((edge) => {
      const incident = hoveredId
        ? edge.source === hoveredId || edge.target === hoveredId
        : true;
      return {
        ...edge,
        selected: edge.id === selection.edgeId,
        className: hoveredId ? (incident ? 'atlas-edge-hl' : 'atlas-faded') : undefined,
      };
    });
  }, [baseEdges, selection.edgeId, hoveredId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removedNodes: string[] = [];
      const removedGroups: string[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moves.push({ id: change.id, position: change.position });
        } else if (change.type === 'remove') {
          const groupId = groupIdOf(change.id);
          if (groupId) {
            removedGroups.push(groupId);
          } else {
            removedNodes.push(change.id);
          }
        }
      }
      moveNodes(moves);
      removeNodes(removedNodes);
      removeGroups(removedGroups);
    },
    [moveNodes, removeNodes, removeGroups],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes
        .filter((change): change is EdgeChange & { type: 'remove' } => change.type === 'remove')
        .map((change) => change.id);
      removeEdges(removed);
    },
    [removeEdges],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        addEdge(connection.source, connection.target);
      }
    },
    [addEdge],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      const componentNode = selNodes.find((n) => groupIdOf(n.id) === null);
      const groupNode = selNodes.find((n) => groupIdOf(n.id) !== null);
      if (componentNode) {
        onSelectionChange({ nodeId: componentNode.id, edgeId: null, groupId: null });
      } else if (groupNode) {
        onSelectionChange({ nodeId: null, edgeId: null, groupId: groupIdOf(groupNode.id) });
      } else {
        onSelectionChange({ nodeId: null, edgeId: selEdges[0]?.id ?? null, groupId: null });
      }
    },
    [onSelectionChange],
  );

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: FlowNodeType) => {
    // Highlight from components and collapsed contexts, not region backgrounds.
    if (!node.id.startsWith(GROUP_ID_PREFIX)) {
      setHoveredId(node.id);
    }
  }, []);
  const handleNodeMouseLeave = useCallback(() => setHoveredId(null), []);

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: FlowNodeType) => {
      const path = (node.data as { node?: { mapping?: { path?: string } } })?.node?.mapping?.path;
      if (path) {
        onOpenFile(path);
      }
    },
    [onOpenFile],
  );

  // Drag a component into a region to join that bounded context (or out to leave).
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: FlowNodeType) => {
      if (node.id.startsWith(GROUP_ID_PREFIX)) {
        return;
      }
      const cx = node.position.x + (node.width ?? 210) / 2;
      const cy = node.position.y + (node.height ?? 60) / 2;
      let targetGroup: string | null = null;
      for (const [groupId, b] of groupBounds(model)) {
        if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) {
          targetGroup = groupId;
          break;
        }
      }
      const current = model.nodes.find((n) => n.id === node.id)?.groupId ?? null;
      if (targetGroup !== current) {
        setNodeGroup(node.id, targetGroup);
      }
    },
    [model, setNodeGroup],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(PALETTE_DND_MIME);
      if (!isNodeTypeId(type)) {
        return;
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = addNode(type, position);
      onSelectionChange({ nodeId: id, edgeId: null, groupId: null });
    },
    [screenToFlowPosition, addNode, onSelectionChange],
  );

  const canvasCallbacks = useMemo(() => ({ onToggleCollapse }), [onToggleCollapse]);

  return (
    <CanvasContext.Provider value={canvasCallbacks}>
    <div className="atlas-canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2a33" />
        <MiniMap
          className="atlas-minimap"
          pannable
          zoomable
          maskColor="rgba(10,10,14,0.6)"
          nodeColor="#3a3a46"
        />
        <Controls className="atlas-controls" showInteractive={false} />
      </ReactFlow>
    </div>
    </CanvasContext.Provider>
  );
}
