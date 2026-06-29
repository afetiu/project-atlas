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

/**
 * Maps an architecture node to its realization in code.
 *
 * This is the bridge that lets Atlas treat the architecture as the source of
 * truth: detection populates it, and code generation reads it to know *where*
 * a component lives. All fields are optional so a freshly drawn node (not yet
 * backed by code) is still valid.
 */
export interface NodeCodeMapping {
  /** Workspace-relative path to the directory/module/file backing this node. */
  path?: string;
  /** Primary language, e.g. "typescript", "go". */
  language?: string;
  /** Framework or runtime, e.g. "express", "react", "postgres". */
  framework?: string;
}

/**
 * Unknown keys preserved verbatim from `atlas.yaml`, so hand-added metadata and
 * fields from a newer schema version survive a read/write round-trip instead of
 * being silently dropped.
 */
export type ExtraFields = Record<string, unknown>;

/** A single architecture component (service, database, queue, …). */
export interface ArchitectureNode {
  id: string;
  name: string;
  type: NodeTypeId;
  description: string;
  position: Position;
  /** Optional link to the code that realizes this component. */
  mapping?: NodeCodeMapping;
  /** Optional bounded context / domain this component belongs to. */
  groupId?: string;
  extra?: ExtraFields;
}

/**
 * A bounded context (a.k.a. domain / container): a logical grouping of
 * components. Rendered as an auto-fitted region behind its members. Groups have
 * no position of their own — the canvas computes their bounds from membership.
 */
export interface ArchitectureGroup {
  id: string;
  name: string;
  description?: string;
  /** Accent colour for the region; assigned from a palette when omitted. */
  color?: string;
  /** Optional link to the module/directory that realizes this context. */
  mapping?: NodeCodeMapping;
  extra?: ExtraFields;
}

/** A directed connection between two nodes, carrying a protocol. */
export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  protocol: ProtocolId;
  extra?: ExtraFields;
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
  groups: ArchitectureGroup[];
  /** Unknown top-level keys (e.g. a future `views` block), preserved verbatim. */
  extra?: ExtraFields;
}

/** The schema version this build reads and writes. */
export const CURRENT_MODEL_VERSION = 1;

/** An empty, valid model — used when no `atlas.yaml` exists yet. */
export function createEmptyModel(): ArchitectureModel {
  return { version: CURRENT_MODEL_VERSION, nodes: [], edges: [], groups: [] };
}
