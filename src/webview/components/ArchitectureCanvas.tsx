/**
 * The architecture canvas — a controlled React Flow surface.
 *
 * React Flow is driven entirely from the domain model: nodes and edges are
 * derived from `model` on each render, and every interaction (move, connect,
 * delete, select, drop) is translated back into a model mutation. There is no
 * second source of truth for the graph inside the canvas.
 */

import React, { useCallback, useMemo } from 'react';
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
import {
  ARCHITECTURE_NODE_TYPE,
  toFlowEdges,
  toFlowNodes,
} from '../adapters/reactFlowAdapter';
import type { ArchitectureModelApi } from '../model/useArchitectureModel';
import { ArchitectureNodeView } from './ArchitectureNodeView';
import { PALETTE_DND_MIME } from './Palette';

export interface Selection {
  nodeId: string | null;
  edgeId: string | null;
}

interface ArchitectureCanvasProps {
  api: ArchitectureModelApi;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
}

const nodeTypes = { [ARCHITECTURE_NODE_TYPE]: ArchitectureNodeView };

export function ArchitectureCanvas({
  api,
  selection,
  onSelectionChange,
}: ArchitectureCanvasProps): JSX.Element {
  const { screenToFlowPosition } = useReactFlow();
  const { model, moveNodes, removeNodes, removeEdges, addEdge, addNode } = api;

  // Derive React Flow state from the model, applying the current selection.
  const nodes = useMemo(() => {
    const flowNodes = toFlowNodes(model);
    return flowNodes.map((node) => ({ ...node, selected: node.id === selection.nodeId }));
  }, [model, selection.nodeId]);

  const edges = useMemo(() => {
    const flowEdges = toFlowEdges(model);
    return flowEdges.map((edge) => ({ ...edge, selected: edge.id === selection.edgeId }));
  }, [model, selection.edgeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
      const removed: string[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moves.push({ id: change.id, position: change.position });
        } else if (change.type === 'remove') {
          removed.push(change.id);
        }
      }
      moveNodes(moves);
      removeNodes(removed);
    },
    [moveNodes, removeNodes],
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
      onSelectionChange({
        nodeId: selNodes[0]?.id ?? null,
        edgeId: selNodes.length === 0 ? selEdges[0]?.id ?? null : null,
      });
    },
    [onSelectionChange],
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
      onSelectionChange({ nodeId: id, edgeId: null });
    },
    [screenToFlowPosition, addNode, onSelectionChange],
  );

  return (
    <div className="atlas-canvas" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
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
  );
}
