/**
 * The architecture canvas — a controlled React Flow surface.
 *
 * React Flow is driven entirely from the domain model: nodes and edges are
 * derived from `model` on each render, and every interaction (move, connect,
 * delete, select, drop) is translated back into a model mutation. There is no
 * second source of truth for the graph inside the canvas.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { isNodeTypeId, type NodeTypeId } from '../../shared/model/nodeTypes';
import type { LensOverlay } from '../../shared/model/lenses';
import type { TracedPath } from '../../shared/model/path';
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
  driftedNodes: ReadonlySet<string>;
  onOpenFile: (path: string) => void;
  collapsedGroups: ReadonlySet<string>;
  onToggleCollapse: (groupId: string) => void;
  typeFilter: ReadonlySet<NodeTypeId>;
  /** Active data-overlay lens (recolours the map); 'structure' is the plain map. */
  overlay: LensOverlay;
  /** UI theme — the graticule/minimap take colours as props, not CSS. */
  theme: 'dark' | 'light';
  /** Focus mode: only this district stays lit; everything else recedes. */
  focusedGroupId: string | null;
  onFocusGroup: (groupId: string | null) => void;
  /** Path tracing: the lit route between two components. */
  tracedPath: TracedPath | null;
  /** Shift-click on a component requests a trace from the current selection. */
  onRequestTrace: (targetId: string) => void;
}

const nodeTypes = {
  [ARCHITECTURE_NODE_TYPE]: ArchitectureNodeView,
  [ARCHITECTURE_GROUP_TYPE]: GroupRegion,
  [ARCHITECTURE_COLLAPSED_TYPE]: CollapsedGroupNode,
};

const edgeTypes = { [ARCHITECTURE_EDGE_TYPE]: FloatingEdge };

// Above this many components, hover-highlighting is disabled: re-deriving every
// node's class on each mouse-enter stops being free, and the visual payoff
// shrinks on a dense canvas. Selection, filtering, and drag still work.
const HOVER_HIGHLIGHT_LIMIT = 150;

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
  driftedNodes,
  onOpenFile,
  collapsedGroups,
  onToggleCollapse,
  typeFilter,
  overlay,
  theme,
  focusedGroupId,
  onFocusGroup,
  tracedPath,
  onRequestTrace,
}: ArchitectureCanvasProps): JSX.Element {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const {
    model,
    moveNodes,
    removeNodes,
    removeEdges,
    removeGroups,
    addEdge,
    addNode,
    setNodeGroup,
    beginInteraction,
    endInteraction,
  } = api;

  // Hovering a node highlights it and its direct neighbours, dimming the rest —
  // but only while the graph is small enough for the per-hover recompute to be
  // cheap (see HOVER_HIGHLIGHT_LIMIT). Clearing is *delayed*: crossing the gap
  // between two nodes must not strobe every edge through unhover/rehover.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnabled = model.nodes.length <= HOVER_HIGHLIGHT_LIMIT;
  useEffect(() => {
    return () => {
      if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    };
  }, []);

  // Fit the whole map into view the first time it becomes non-empty (e.g. a
  // detection or extraction loads a large model after mount), so it's never
  // left zoomed into a corner.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && model.nodes.length > 0) {
      fittedRef.current = true;
      // Defer a frame so the nodes are measured before fitting.
      setTimeout(() => fitView({ padding: 0.1, duration: 350 }), 60);
    } else if (model.nodes.length === 0) {
      fittedRef.current = false;
    }
  }, [model.nodes.length, fitView]);

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

  // Trace/focus emphasis: while either is active, hover-dimming yields to it.
  const traceNodes = useMemo(
    () => (tracedPath ? new Set(tracedPath.nodeIds) : null),
    [tracedPath],
  );
  const traceEdges = useMemo(
    () => (tracedPath ? new Set(tracedPath.edgeIds) : null),
    [tracedPath],
  );
  const focusMembers = useMemo(() => {
    if (!focusedGroupId) {
      return null;
    }
    return new Set(
      model.nodes.filter((n) => n.groupId === focusedGroupId).map((n) => n.id),
    );
  }, [model.nodes, focusedGroupId]);

  // Derive React Flow state from the model, applying the current selection.
  // Group regions are listed first so they render behind the components.
  const filtering = typeFilter.size > 0;
  const nodes = useMemo(() => {
    // A node is dimmed if hover excludes it, or a type filter is active and the
    // node's type isn't selected. Type-less nodes (collapsed contexts) only
    // respond to the hover dimming.
    const faded = (id: string, type?: NodeTypeId) => {
      // Priority: an active trace or focus owns the emphasis; hover only
      // applies when neither is active, so the modes never fight each other.
      if (traceNodes) {
        return traceNodes.has(id) ? undefined : 'atlas-faded';
      }
      if (focusMembers) {
        return focusMembers.has(id) ? undefined : 'atlas-faded';
      }
      const dimByHover = neighborIds ? !neighborIds.has(id) : false;
      const dimByType = filtering && (type === undefined || !typeFilter.has(type));
      return dimByHover || dimByType ? 'atlas-faded' : undefined;
    };
    const groupNodes = toFlowGroups(model, collapsedGroups).map((group) => ({
      ...group,
      selected: group.id === `${GROUP_ID_PREFIX}${selection.groupId}`,
      className:
        focusedGroupId && group.id !== `${GROUP_ID_PREFIX}${focusedGroupId}`
          ? 'atlas-faded'
          : undefined,
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
      className: faded(node.id, node.data.node.type),
      data: {
        ...node.data,
        issueSeverity: issueByNode.get(node.id),
        drifted: driftedNodes.has(node.id),
        // The active map lens recolours each node by its semantic tone.
        overlayTone: overlay.nodeTone.get(node.id),
      },
    }));
    return [...groupNodes, ...collapsedNodes, ...flowNodes];
  }, [
    model,
    selection.nodeId,
    selection.groupId,
    issueByNode,
    driftedNodes,
    collapsedGroups,
    neighborIds,
    filtering,
    typeFilter,
    overlay,
    traceNodes,
    focusMembers,
    focusedGroupId,
  ]);

  const edges = useMemo(() => {
    return baseEdges.map((edge) => {
      const incident = hoveredId
        ? edge.source === hoveredId || edge.target === hoveredId
        : true;
      const tone = overlay.edgeTone.get(edge.id);
      const weight = overlay.edgeWeight.get(edge.id);
      const onPath = traceEdges ? traceEdges.has(edge.id) : undefined;
      const inFocus = focusMembers
        ? focusMembers.has(edge.source) && focusMembers.has(edge.target)
        : undefined;
      const hoverClass =
        onPath !== undefined
          ? onPath
            ? 'atlas-edge-hl'
            : 'atlas-faded'
          : inFocus !== undefined
            ? inFocus
              ? undefined
              : 'atlas-faded'
            : hoveredId
              ? incident
                ? 'atlas-edge-hl'
                : 'atlas-faded'
              : undefined;
      const toneClass = tone ? `atlas-edge--${tone}` : undefined;
      // dim/hl also travel through data: the protocol label renders in a portal,
      // so classes on the edge element can never reach it.
      const dim = onPath !== undefined ? !onPath : inFocus !== undefined ? !inFocus : hoveredId ? !incident : false;
      const hl = onPath !== undefined ? onPath : hoveredId ? incident : false;
      // Traffic-lens roads and hover-highlighted connections carry animated flow.
      const flowClass = weight !== undefined || hl ? 'atlas-edge--flow' : undefined;
      return {
        ...edge,
        selected: edge.id === selection.edgeId,
        className: [hoverClass, toneClass, flowClass].filter(Boolean).join(' ') || undefined,
        data: { ...edge.data, weight, dim, hl },
      };
    });
  }, [baseEdges, selection.edgeId, hoveredId, overlay, traceEdges, focusMembers]);

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

  const handleNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: FlowNodeType) => {
      // Highlight from components and collapsed contexts, not region backgrounds.
      if (hoverEnabled && !node.id.startsWith(GROUP_ID_PREFIX)) {
        if (hoverClearTimer.current) {
          clearTimeout(hoverClearTimer.current);
          hoverClearTimer.current = null;
        }
        setHoveredId(node.id);
      }
    },
    [hoverEnabled],
  );
  const handleNodeMouseLeave = useCallback(() => {
    if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = setTimeout(() => setHoveredId(null), 150);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: FlowNodeType) => {
      // Double-tapping a district enters focus mode; double-tapping a mapped
      // component opens its source.
      const groupId = groupIdOf(node.id);
      if (groupId) {
        onFocusGroup(groupId);
        return;
      }
      const path = (node.data as { node?: { mapping?: { path?: string } } })?.node?.mapping?.path;
      if (path) {
        onOpenFile(path);
      }
    },
    [onOpenFile, onFocusGroup],
  );

  // Shift-click a second component to trace the route from the selected one.
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: FlowNodeType) => {
      if (event.shiftKey && groupIdOf(node.id) === null) {
        onRequestTrace(node.id);
      }
    },
    [onRequestTrace],
  );

  // Drag a component into a region to join that bounded context (or out to leave).
  const handleNodeDragStart = useCallback(() => beginInteraction(), [beginInteraction]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: FlowNodeType) => {
      endInteraction();
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

  const canvasCallbacks = useMemo(() => ({ onToggleCollapse, onFocusGroup }), [onToggleCollapse, onFocusGroup]);

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
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        {/* A faint graticule (like a sea-chart grid) over the water base set in
            CSS, so the canvas reads as a map surface rather than a blank pane. */}
        <Background
          variant={BackgroundVariant.Lines}
          gap={64}
          size={1}
          color={theme === 'light' ? 'rgba(120,100,60,0.09)' : 'rgba(200,170,120,0.05)'}
        />
        <Background
          id="fine"
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1}
          color={theme === 'light' ? 'rgba(120,100,60,0.12)' : 'rgba(200,170,120,0.07)'}
        />
        <MiniMap
          className="atlas-minimap"
          pannable
          zoomable
          maskColor={theme === 'light' ? 'rgba(228,218,196,0.75)' : 'rgba(12,10,8,0.72)'}
          nodeColor={(n) => {
            // Districts paint the minimap like a world-map inset; components
            // read as small settlements on top.
            if (n.type === ARCHITECTURE_GROUP_TYPE) {
              const g = (n.data as { group?: { color?: string } })?.group;
              return g?.color ?? '#c89b6c';
            }
            return theme === 'light' ? '#b3a385' : '#6b5f49';
          }}
          nodeStrokeWidth={2}
        />
        <Controls className="atlas-controls" showInteractive={false} />
      </ReactFlow>
    </div>
    </CanvasContext.Provider>
  );
}
