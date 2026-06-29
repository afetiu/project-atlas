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

import { NODE_TYPES, type NodeTypeId } from '../../shared/model/nodeTypes';
import { DEFAULT_PROTOCOL, type ProtocolId } from '../../shared/model/protocols';
import {
  createEmptyModel,
  type ArchitectureEdge,
  type ArchitectureModel,
  type ArchitectureNode,
  type Position,
} from '../../shared/model/types';
import { onHostMessage, postToHost } from '../vscodeApi';
import { makeEdgeId, makeUniqueNodeId } from './ids';

const PERSIST_DEBOUNCE_MS = 250;

export interface NodeEdits {
  name?: string;
  type?: NodeTypeId;
  description?: string;
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
}

export function useArchitectureModel(): ArchitectureModelApi {
  const [model, setModel] = useState<ArchitectureModel>(createEmptyModel);
  const [error, setError] = useState<string | null>(null);

  // A mirror of `model` for synchronous reads inside mutators, avoiding stale
  // closures without forcing every mutator to depend on `model`.
  const modelRef = useRef(model);
  modelRef.current = model;

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePersist = useCallback((next: ArchitectureModel) => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
    }
    persistTimer.current = setTimeout(() => {
      postToHost({ type: 'model:changed', model: next });
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  /** Apply a pure transform, update state, and schedule a save. */
  const commit = useCallback(
    (transform: (current: ArchitectureModel) => ArchitectureModel) => {
      const next = transform(modelRef.current);
      modelRef.current = next;
      setModel(next);
      schedulePersist(next);
    },
    [schedulePersist],
  );

  /* ---- Incoming authoritative models from the host ---- */
  useEffect(() => {
    const unsubscribe = onHostMessage((message) => {
      switch (message.type) {
        case 'model:loaded':
          // Replace local state without persisting — this came *from* disk.
          modelRef.current = message.model;
          setModel(message.model);
          setError(null);
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
  };
}
