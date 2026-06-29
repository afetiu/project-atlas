/**
 * Contract for AI repository detection.
 *
 * Detection asks Claude to analyze a repository and emit a structured
 * description of its architecture. This module defines the JSON Schema the
 * model must satisfy and the converter that turns its loosely-typed output
 * into a fully normalized, laid-out {@link ArchitectureModel}.
 *
 * Living in `shared/` keeps the AI contract decoupled from the Agent SDK — the
 * extension wires it to `query()`, but the shape and normalization are testable
 * in isolation.
 */

import { NODE_TYPE_IDS, isNodeTypeId } from '../model/nodeTypes';
import { PROTOCOL_IDS, DEFAULT_PROTOCOL, isProtocolId } from '../model/protocols';
import { computeLayout } from '../model/layout';
import {
  CURRENT_MODEL_VERSION,
  type ArchitectureEdge,
  type ArchitectureModel,
  type ArchitectureNode,
  type NodeCodeMapping,
} from '../model/types';

export interface DetectedNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  path?: string;
  language?: string;
  framework?: string;
}

export interface DetectedEdge {
  source: string;
  target: string;
  protocol: string;
}

export interface DetectedArchitecture {
  nodes: DetectedNode[];
  edges: DetectedEdge[];
}

/** JSON Schema handed to the Agent SDK as `outputFormat`. */
export function buildDetectionSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'Stable kebab-case identifier.' },
            name: { type: 'string', description: 'Human-readable component name.' },
            type: { type: 'string', enum: [...NODE_TYPE_IDS] },
            description: { type: 'string' },
            path: {
              type: 'string',
              description: 'Workspace-relative path to the code for this component.',
            },
            language: { type: 'string' },
            framework: { type: 'string' },
          },
          required: ['id', 'name', 'type'],
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', description: 'id of the calling component.' },
            target: { type: 'string', description: 'id of the called component.' },
            protocol: { type: 'string', enum: [...PROTOCOL_IDS] },
          },
          required: ['source', 'target', 'protocol'],
        },
      },
    },
    required: ['nodes', 'edges'],
  };
}

/**
 * Normalize raw detection output into a valid, laid-out model:
 *  - guarantees unique node ids,
 *  - coerces unknown types/protocols to safe defaults,
 *  - drops edges that reference unknown nodes,
 *  - assigns deterministic positions.
 */
export interface DetectedToModelOptions {
  /** Keep coordinates for nodes whose id already exists in this model. */
  preservePositionsFrom?: ArchitectureModel;
}

export function detectedToModel(
  detected: DetectedArchitecture,
  options: DetectedToModelOptions = {},
): ArchitectureModel {
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const nodes: ArchitectureNode[] = [];

  for (const raw of detected.nodes ?? []) {
    const originalId = (raw.id || raw.name || 'node').trim();
    const finalId = uniqueId(slugify(originalId), used);
    used.add(finalId);
    idMap.set(originalId, finalId);

    nodes.push({
      id: finalId,
      name: (raw.name || originalId).trim(),
      type: isNodeTypeId(raw.type) ? raw.type : 'service',
      description: raw.description?.trim() ?? '',
      position: { x: 0, y: 0 },
      mapping: toMapping(raw),
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdges = new Set<string>();
  const edges: ArchitectureEdge[] = [];

  for (const raw of detected.edges ?? []) {
    const source = idMap.get((raw.source || '').trim()) ?? slugify(raw.source || '');
    const target = idMap.get((raw.target || '').trim()) ?? slugify(raw.target || '');
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      continue;
    }
    const dedupeKey = `${source}->${target}`;
    if (seenEdges.has(dedupeKey)) {
      continue;
    }
    seenEdges.add(dedupeKey);
    edges.push({
      id: `edge-${source}-${target}`,
      source,
      target,
      protocol: isProtocolId(raw.protocol) ? raw.protocol : DEFAULT_PROTOCOL,
    });
  }

  const previous = new Map(
    (options.preservePositionsFrom?.nodes ?? []).map((n) => [n.id, n.position]),
  );
  const positions = computeLayout(nodes, edges);
  for (const node of nodes) {
    node.position = previous.get(node.id) ?? positions.get(node.id) ?? node.position;
  }

  return { version: CURRENT_MODEL_VERSION, nodes, edges };
}

function toMapping(raw: DetectedNode): NodeCodeMapping | undefined {
  const mapping: NodeCodeMapping = {};
  if (raw.path?.trim()) mapping.path = raw.path.trim();
  if (raw.language?.trim()) mapping.language = raw.language.trim();
  if (raw.framework?.trim()) mapping.framework = raw.framework.trim();
  return mapping.path || mapping.language || mapping.framework ? mapping : undefined;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node'
  );
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }
  let counter = 2;
  while (used.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}
