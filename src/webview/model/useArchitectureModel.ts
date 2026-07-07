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
import { computeMapLayout } from '../../shared/model/mapLayout';
import { NODE_TYPES, type NodeTypeId } from '../../shared/model/nodeTypes';
import { DEFAULT_PROTOCOL, type ProtocolId } from '../../shared/model/protocols';
import {
  createEmptyModel,
  type ArchitectureEdge,
  type ArchitectureGroup,
  type ArchitectureModel,
  type ArchitectureNode,
  type NodeBinding,
  type Position,
} from '../../shared/model/types';
import { onHostMessage, postToHost } from '../vscodeApi';
import { makeEdgeId, makeUniqueGroupId, makeUniqueNodeId } from './ids';

const PERSIST_DEBOUNCE_MS = 250;

export interface NodeEdits {
  name?: string;
  type?: NodeTypeId;
  description?: string;
  /** Live MCP binding; pass null/undefined to clear. */
  binding?: NodeBinding;
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
  loadModel: (model: ArchitectureModel) => void;
  arrangeAsMap: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  beginInteraction: () => void;
  endInteraction: () => void;
  /**
   * Sandbox (plan mode): edits flow through the same mutators but are *not*
   * persisted to atlas.yaml; the real model is kept as `baseModel` for diffing.
   */
  sandboxed: boolean;
  baseModel: ArchitectureModel | null;
  enterSandbox: (target: ArchitectureModel) => void;
  exitSandbox: () => void;
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

  // Sandbox (plan mode): while active, edits stay local and the authoritative
  // model is parked in `baseModel` so a plan can be assessed against it.
  const [sandboxed, setSandboxed] = useState(false);
  const sandboxedRef = useRef(false);
  const [baseModel, setBaseModel] = useState<ArchitectureModel | null>(null);
  const baseModelRef = useRef<ArchitectureModel | null>(null);

  // Undo/redo history of full model snapshots. A version counter forces
  // re-render so `canUndo`/`canRedo` (read from the refs) stay accurate.
  const undoStack = useRef<ArchitectureModel[]>([]);
  const redoStack = useRef<ArchitectureModel[]>([]);
  const [, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const schedulePersist = useCallback((next: ArchitectureModel) => {
    // Sandboxed edits never reach atlas.yaml — plan persistence is the plan
    // owner's job (it watches `model` and saves to the plan file instead).
    if (sandboxedRef.current) {
      return;
    }
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

  /** Replace the entire model (e.g. apply a starter template) as one undoable step. */
  const loadModel = useCallback(
    (next: ArchitectureModel) => {
      commit(() => next);
    },
    [commit],
  );

  /** Re-arrange every component into the cartographic "map" layout (one undo step). */
  const arrangeAsMap = useCallback(() => {
    commit((current) => {
      const positions = computeMapLayout(current.nodes, current.edges);
      return {
        ...current,
        nodes: current.nodes.map((node) => ({
          ...node,
          position: positions.get(node.id) ?? node.position,
        })),
      };
    });
  }, [commit]);

  /** Apply a transform without recording history (used for live drag frames). */
  const commitNoHistory = useCallback(
    (transform: (current: ArchitectureModel) => ArchitectureModel) => {
      const next = transform(modelRef.current);
      if (next === modelRef.current) {
        return;
      }
      modelRef.current = next;
      setModel(next);
      schedulePersist(next);
    },
    [schedulePersist],
  );

  // A canvas interaction (e.g. a drag) is a single undoable step: snapshot at
  // the start, push one history entry at the end if anything actually changed.
  const interactionStart = useRef<ArchitectureModel | null>(null);
  const beginInteraction = useCallback(() => {
    interactionStart.current = modelRef.current;
  }, []);
  const endInteraction = useCallback(() => {
    const start = interactionStart.current;
    interactionStart.current = null;
    if (start && start !== modelRef.current) {
      undoStack.current.push(start);
      if (undoStack.current.length > HISTORY_LIMIT) {
        undoStack.current.shift();
      }
      redoStack.current = [];
      bumpHistory();
    }
  }, [bumpHistory]);

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
          // While sandboxed, the authoritative model only refreshes the diff
          // baseline — a disk reload must not clobber the plan being drafted.
          if (sandboxedRef.current) {
            baseModelRef.current = message.model;
            setBaseModel(message.model);
            setError(null);
            break;
          }
          // Replace local state without persisting — this came *from* disk.
          // Cancel any pending autosave so a stale local edit can't clobber the
          // authoritative version we just received.
          if (persistTimer.current) {
            clearTimeout(persistTimer.current);
            persistTimer.current = null;
          }
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

  /* ---- Sandbox (plan mode) ---- */

  const enterSandbox = useCallback(
    (target: ArchitectureModel) => {
      if (sandboxedRef.current) {
        return;
      }
      // Flush any pending real edit *before* suspending persistence, so
      // entering a plan can never swallow a change to atlas.yaml.
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
        postToHost({ type: 'model:changed', model: modelRef.current });
      }
      baseModelRef.current = modelRef.current;
      setBaseModel(modelRef.current);
      sandboxedRef.current = true;
      setSandboxed(true);
      modelRef.current = target;
      setModel(target);
      undoStack.current = [];
      redoStack.current = [];
      bumpHistory();
    },
    [bumpHistory],
  );

  const exitSandbox = useCallback(() => {
    if (!sandboxedRef.current) {
      return;
    }
    const base = baseModelRef.current ?? modelRef.current;
    sandboxedRef.current = false;
    setSandboxed(false);
    baseModelRef.current = null;
    setBaseModel(null);
    modelRef.current = base;
    setModel(base);
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
  }, [bumpHistory]);

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
      // Live drag frames update position without flooding the undo stack; the
      // surrounding begin/endInteraction records one entry for the whole drag.
      commitNoHistory((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          byId.has(node.id) ? { ...node, position: byId.get(node.id)! } : node,
        ),
      }));
    },
    [commitNoHistory],
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
    loadModel,
    arrangeAsMap,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    beginInteraction,
    endInteraction,
    sandboxed,
    baseModel,
    enterSandbox,
    exitSandbox,
  };
}
