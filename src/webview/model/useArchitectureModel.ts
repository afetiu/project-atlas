/**
 * Central state hook for the architecture model inside the webview.
 *
 * This hook is the webview's source of truth. It:
 *   - holds the current {@link ArchitectureModel}
 *   - applies user edits through small, intention-revealing mutators
 *   - debounces persistence so edits auto-save without a save button
 *   - reconciles authoritative models pushed from the extension host
 *
 * Components never mutate the model directly — they call a mutator, which keeps
 * the persistence and validation policy in exactly one place.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { groupColorForIndex } from '../../shared/model/groups';
import { NODE_TYPES, type NodeTypeId } from '../../shared/model/nodeTypes';
import { DEFAULT_PROTOCOL, type ProtocolId } from '../../shared/model/protocols';
import {
  createEmptyModel,
  type ArchitectureEdge,
  type ArchitectureGroup,
  type ArchitectureModel,
  type ArchitectureNode,
  type Position,
} from '../../shared/model/types';
import { onHostMessage, postToHost } from '../vscodeApi';
import { makeEdgeId, makeUniqueGroupId, makeUniqueNodeId } from './ids';

const PERSIST_DEBOUNCE_MS = 250;

export interface NodeEdits {
  name?: string;
  type?: NodeTypeId;
  description?: string;
}

export interface GroupEdits {
  name?: string;
  description?: string;
  color?: string;
}

export interface ArchitectureModelApi {
  model: ArchitectureModel;
  error: string | null;
  addNode: (type: NodeTypeId, position: Position) => string;
  updateNode: (id: string, edits: NodeEdits) => void;
  moveNodes: (moves: Array<{ id: string; position: Position }>) => void;
  removeNodes: (ids: string[]) => void;
  addEdge: (source: string, target: string) => void;
  updateEdgeProtocol: (id: string, protocol: ProtocolId) => void;
  removeEdges: (ids: string[]) => void;
  addGroup: (name: string) => string;
  updateGroup: (id: string, edits: GroupEdits) => void;
  removeGroups: (ids: string[]) => void;
  setNodeGroup: (nodeId: string, groupId: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const HISTORY_LIMIT = 100;

export function useArchitectureModel(): ArchitectureModelApi {
  const [model, setModel] = useState<ArchitectureModel>(createEmptyModel);
  const [error, setError] = useState<string | null>(null);

  // A mirror of `model` for synchronous reads inside mutators, avoiding stale
  // closures without forcing every mutator to depend on `model`.
  const modelRef = useRef(model);
  modelRef.current = model;

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo/redo history of full model snapshots. A version counter forces
  // re-render so `canUndo`/`canRedo` (read from the refs) stay accurate.
  const undoStack = useRef<ArchitectureModel[]>([]);
  const redoStack = useRef<ArchitectureModel[]>([]);
  const [, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const schedulePersist = useCallback((next: ArchitectureModel) => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
    }
    persistTimer.current = setTimeout(() => {
      postToHost({ type: 'model:changed', model: next });
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  /** Apply a pure transform, record history, update state, and schedule a save. */
  const commit = useCallback(
    (transform: (current: ArchitectureModel) => ArchitectureModel) => {
      const prev = modelRef.current;
      const next = transform(prev);
      if (next === prev) {
        return; // no-op transform (e.g. duplicate edge) — don't pollute history.
      }
      undoStack.current.push(prev);
      if (undoStack.current.length > HISTORY_LIMIT) {
        undoStack.current.shift();
      }
      redoStack.current = [];
      modelRef.current = next;
      setModel(next);
      schedulePersist(next);
      bumpHistory();
    },
    [schedulePersist, bumpHistory],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) {
      return;
    }
    redoStack.current.push(modelRef.current);
    modelRef.current = previous;
    setModel(previous);
    schedulePersist(previous);
    bumpHistory();
  }, [schedulePersist, bumpHistory]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) {
      return;
    }
    undoStack.current.push(modelRef.current);
    modelRef.current = next;
    setModel(next);
    schedulePersist(next);
    bumpHistory();
  }, [schedulePersist, bumpHistory]);

  /* ---- Incoming authoritative models from the host ---- */
  useEffect(() => {
    const unsubscribe = onHostMessage((message) => {
      switch (message.type) {
        case 'model:loaded':
          // Replace local state without persisting — this came *from* disk.
          // History doesn't span external reloads, so reset it.
          modelRef.current = message.model;
          setModel(message.model);
          setError(null);
          undoStack.current = [];
          redoStack.current = [];
          bumpHistory();
          break;
        case 'model:error':
          setError(message.message);
          break;
      }
    });
    postToHost({ type: 'webview:ready' });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
      }
    };
  }, []);

  /* ---- Mutators ---- */

  const addNode = useCallback(
    (type: NodeTypeId, position: Position): string => {
      const id = makeUniqueNodeId(modelRef.current, NODE_TYPES[type].label);
      const node: ArchitectureNode = {
        id,
        name: NODE_TYPES[type].label,
        type,
        description: '',
        position,
      };
      commit((current) => ({ ...current, nodes: [...current.nodes, node] }));
      return id;
    },
    [commit],
  );

  const updateNode = useCallback(
    (id: string, edits: NodeEdits) => {
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, ...edits } : node,
        ),
      }));
    },
    [commit],
  );

  const moveNodes = useCallback(
    (moves: Array<{ id: string; position: Position }>) => {
      if (moves.length === 0) {
        return;
      }
      const byId = new Map(moves.map((move) => [move.id, move.position]));
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          byId.has(node.id) ? { ...node, position: byId.get(node.id)! } : node,
        ),
      }));
    },
    [commit],
  );

  const removeNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const removed = new Set(ids);
      commit((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !removed.has(node.id)),
        // Remove dangling edges so we never produce a broken edge.
        edges: current.edges.filter(
          (edge) => !removed.has(edge.source) && !removed.has(edge.target),
        ),
      }));
    },
    [commit],
  );

  const addEdge = useCallback(
    (source: string, target: string) => {
      if (source === target) {
        return;
      }
      commit((current) => {
        const exists = current.edges.some(
          (edge) => edge.source === source && edge.target === target,
        );
        if (exists) {
          return current;
        }
        const edge: ArchitectureEdge = {
          id: makeEdgeId(current, source, target),
          source,
          target,
          protocol: DEFAULT_PROTOCOL,
        };
        return { ...current, edges: [...current.edges, edge] };
      });
    },
    [commit],
  );

  const updateEdgeProtocol = useCallback(
    (id: string, protocol: ProtocolId) => {
      commit((current) => ({
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === id ? { ...edge, protocol } : edge,
        ),
      }));
    },
    [commit],
  );

  const removeEdges = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const removed = new Set(ids);
      commit((current) => ({
        ...current,
        edges: current.edges.filter((edge) => !removed.has(edge.id)),
      }));
    },
    [commit],
  );

  const addGroup = useCallback(
    (name: string): string => {
      const id = makeUniqueGroupId(modelRef.current, name);
      const group: ArchitectureGroup = {
        id,
        name,
        color: groupColorForIndex(modelRef.current.groups.length),
      };
      commit((current) => ({ ...current, groups: [...current.groups, group] }));
      return id;
    },
    [commit],
  );

  const updateGroup = useCallback(
    (id: string, edits: GroupEdits) => {
      commit((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === id ? { ...group, ...edits } : group,
        ),
      }));
    },
    [commit],
  );

  const removeGroups = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const removed = new Set(ids);
      commit((current) => ({
        ...current,
        groups: current.groups.filter((group) => !removed.has(group.id)),
        // Detach members of removed groups.
        nodes: current.nodes.map((node) =>
          node.groupId && removed.has(node.groupId)
            ? { ...node, groupId: undefined }
            : node,
        ),
      }));
    },
    [commit],
  );

  const setNodeGroup = useCallback(
    (nodeId: string, groupId: string | null) => {
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId ? { ...node, groupId: groupId ?? undefined } : node,
        ),
      }));
    },
    [commit],
  );

  return {
    model,
    error,
    addNode,
    updateNode,
    moveNodes,
    removeNodes,
    addEdge,
    updateEdgeProtocol,
    removeEdges,
    addGroup,
    updateGroup,
    removeGroups,
    setNodeGroup,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
