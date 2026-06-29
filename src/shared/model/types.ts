/**
 * Core domain types for the Atlas architecture model.
 *
 * These types are the single source of truth for the shape of an architecture
 * graph. They are intentionally framework-agnostic: nothing here knows about
 * React Flow, VS Code, or YAML. Both the extension host and the webview depend
 * on this module, never the other way around.
 */

import type { NodeTypeId } from './nodeTypes';
import type { ProtocolId } from './protocols';

/** A point on the canvas. Persisted so layout survives reloads. */
export interface Position {
  x: number;
  y: number;
}

/** A single architecture component (service, database, queue, …). */
export interface ArchitectureNode {
  id: string;
  name: string;
  type: NodeTypeId;
  description: string;
  position: Position;
}

/** A directed connection between two nodes, carrying a protocol. */
export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  protocol: ProtocolId;
}

/**
 * The complete architecture model. This object serializes 1:1 into
 * `atlas.yaml` at the workspace root.
 */
export interface ArchitectureModel {
  /** Schema version, to allow safe migrations as the format evolves. */
  version: number;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

/** The schema version this build reads and writes. */
export const CURRENT_MODEL_VERSION = 1;

/** An empty, valid model — used when no `atlas.yaml` exists yet. */
export function createEmptyModel(): ArchitectureModel {
  return { version: CURRENT_MODEL_VERSION, nodes: [], edges: [] };
}
