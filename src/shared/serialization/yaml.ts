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
  type ArchitectureGroup,
  type ArchitectureModel,
  type ArchitectureNode,
  type NodeCodeMapping,
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
      // Only emit optional fields when they carry information, keeping the file lean.
      ...(node.groupId ? { groupId: node.groupId } : {}),
      ...(hasMapping(node.mapping) ? { mapping: compactMapping(node.mapping!) } : {}),
      ...(node.extra ?? {}),
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      protocol: edge.protocol,
      ...(edge.extra ?? {}),
    })),
    groups: model.groups.map((group) => ({
      id: group.id,
      name: group.name,
      ...(group.description ? { description: group.description } : {}),
      ...(group.color ? { color: group.color } : {}),
      ...(hasMapping(group.mapping) ? { mapping: compactMapping(group.mapping!) } : {}),
      ...(group.extra ?? {}),
    })),
    ...(model.extra ?? {}),
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
  const groups = Array.isArray(record.groups) ? record.groups.map(normalizeGroup) : [];
  const extra = extraOf(record, ['version', 'nodes', 'edges', 'groups']);

  return extra ? { version, nodes, edges, groups, extra } : { version, nodes, edges, groups };
}

function normalizeNode(raw: unknown, index: number): ArchitectureNode {
  const record = (raw ?? {}) as Record<string, unknown>;
  const id = asString(record.id) || `node-${index}`;
  const node: ArchitectureNode = {
    id,
    name: asString(record.name) || id,
    type: isNodeTypeId(record.type) ? record.type : 'service',
    description: asString(record.description),
    position: normalizePosition(record.position),
  };
  const mapping = normalizeMapping(record.mapping);
  if (mapping) {
    node.mapping = mapping;
  }
  const groupId = asString(record.groupId);
  if (groupId) {
    node.groupId = groupId;
  }
  const extra = extraOf(record, [
    'id',
    'name',
    'type',
    'description',
    'position',
    'mapping',
    'groupId',
  ]);
  if (extra) {
    node.extra = extra;
  }
  return node;
}

function normalizeGroup(raw: unknown, index: number): ArchitectureGroup {
  const record = (raw ?? {}) as Record<string, unknown>;
  const id = asString(record.id) || `group-${index}`;
  const group: ArchitectureGroup = {
    id,
    name: asString(record.name) || id,
  };
  const description = asString(record.description);
  if (description) {
    group.description = description;
  }
  const color = asString(record.color);
  if (color) {
    group.color = color;
  }
  const mapping = normalizeMapping(record.mapping);
  if (mapping) {
    group.mapping = mapping;
  }
  const extra = extraOf(record, ['id', 'name', 'description', 'color', 'mapping']);
  if (extra) {
    group.extra = extra;
  }
  return group;
}

/** Collect keys not in `known` so unknown/future fields survive a round-trip. */
function extraOf(
  record: Record<string, unknown>,
  known: string[],
): Record<string, unknown> | undefined {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      rest[key] = record[key];
    }
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function normalizeMapping(raw: unknown): NodeCodeMapping | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const mapping = compactMapping({
    path: asString(record.path) || undefined,
    language: asString(record.language) || undefined,
    framework: asString(record.framework) || undefined,
  });
  return hasMapping(mapping) ? mapping : undefined;
}

function compactMapping(mapping: NodeCodeMapping): NodeCodeMapping {
  const result: NodeCodeMapping = {};
  if (mapping.path) result.path = mapping.path;
  if (mapping.language) result.language = mapping.language;
  if (mapping.framework) result.framework = mapping.framework;
  return result;
}

function hasMapping(mapping: NodeCodeMapping | undefined): boolean {
  return !!mapping && (!!mapping.path || !!mapping.language || !!mapping.framework);
}

function normalizeEdge(raw: unknown, index: number): ArchitectureEdge {
  const record = (raw ?? {}) as Record<string, unknown>;
  const edge: ArchitectureEdge = {
    id: asString(record.id) || `edge-${index}`,
    source: asString(record.source),
    target: asString(record.target),
    protocol: isProtocolId(record.protocol) ? record.protocol : DEFAULT_PROTOCOL,
  };
  const extra = extraOf(record, ['id', 'source', 'target', 'protocol']);
  if (extra) {
    edge.extra = extra;
  }
  return edge;
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
