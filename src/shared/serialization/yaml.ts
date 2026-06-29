/**
 * YAML (de)serialization for the architecture model.
 *
 * This module is the only place that knows the on-disk representation of
 * `atlas.yaml`. It normalizes loosely-typed parsed data into the strict domain
 * model and produces stable, human-friendly YAML on the way back out.
 */

import { parse, stringify } from 'yaml';

import { isNodeTypeId } from '../model/nodeTypes';
import { DEFAULT_PROTOCOL, isProtocolId } from '../model/protocols';
import {
  CURRENT_MODEL_VERSION,
  createEmptyModel,
  type ArchitectureEdge,
  type ArchitectureModel,
  type ArchitectureNode,
  type Position,
} from '../model/types';

export class AtlasParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AtlasParseError';
  }
}

/** Serialize a model into the canonical `atlas.yaml` document. */
export function serializeModel(model: ArchitectureModel): string {
  // Build a plain object explicitly so we control key ordering and never leak
  // transient UI state into the persisted file.
  const document = {
    version: model.version ?? CURRENT_MODEL_VERSION,
    nodes: model.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      description: node.description,
      position: { x: round(node.position.x), y: round(node.position.y) },
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      protocol: edge.protocol,
    })),
  };

  return stringify(document, { indent: 2, lineWidth: 0 });
}

/**
 * Parse raw YAML text into a normalized model.
 *
 * Throws {@link AtlasParseError} on invalid YAML. Structural problems beyond
 * "is this valid YAML" are reported separately via `validateModel`.
 */
export function deserializeModel(text: string): ArchitectureModel {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return createEmptyModel();
  }

  let raw: unknown;
  try {
    raw = parse(trimmed);
  } catch (error) {
    throw new AtlasParseError('atlas.yaml is not valid YAML.', error);
  }

  if (raw === null || typeof raw !== 'object') {
    throw new AtlasParseError('atlas.yaml must contain a mapping at the top level.');
  }

  const record = raw as Record<string, unknown>;
  const version = typeof record.version === 'number' ? record.version : CURRENT_MODEL_VERSION;
  const nodes = Array.isArray(record.nodes) ? record.nodes.map(normalizeNode) : [];
  const edges = Array.isArray(record.edges) ? record.edges.map(normalizeEdge) : [];

  return { version, nodes, edges };
}

function normalizeNode(raw: unknown, index: number): ArchitectureNode {
  const record = (raw ?? {}) as Record<string, unknown>;
  const id = asString(record.id) || `node-${index}`;
  return {
    id,
    name: asString(record.name) || id,
    type: isNodeTypeId(record.type) ? record.type : 'service',
    description: asString(record.description),
    position: normalizePosition(record.position),
  };
}

function normalizeEdge(raw: unknown, index: number): ArchitectureEdge {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asString(record.id) || `edge-${index}`,
    source: asString(record.source),
    target: asString(record.target),
    protocol: isProtocolId(record.protocol) ? record.protocol : DEFAULT_PROTOCOL,
  };
}

function normalizePosition(raw: unknown): Position {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    x: asNumber(record.x),
    y: asNumber(record.y),
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
