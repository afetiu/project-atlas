/**
 * Contract for the in-canvas AI conversation.
 *
 * A chat turn returns a natural-language `reply` and, optionally, a `proposal`:
 * a complete desired architecture the user can review and apply. Returning the
 * full target graph (rather than a patch) keeps the contract simple and lets
 * the existing diff engine compute exactly what changed.
 */

import { NODE_TYPE_IDS } from '../model/nodeTypes';
import { PROTOCOL_IDS } from '../model/protocols';
import type { DetectedEdge, DetectedNode } from './detection';

export interface ChatProposal {
  /** One-line summary of what the proposed change does. */
  summary: string;
  nodes: DetectedNode[];
  edges: DetectedEdge[];
}

export interface ChatResponse {
  reply: string;
  proposal?: ChatProposal | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** JSON Schema handed to the Agent SDK as `outputFormat` for chat turns. */
export function buildChatSchema(): Record<string, unknown> {
  const nodeItem = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string', enum: [...NODE_TYPE_IDS] },
      description: { type: 'string' },
      path: { type: 'string' },
      language: { type: 'string' },
      framework: { type: 'string' },
    },
    required: ['id', 'name', 'type'],
  };
  const edgeItem = {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string' },
      target: { type: 'string' },
      protocol: { type: 'string', enum: [...PROTOCOL_IDS] },
    },
    required: ['source', 'target', 'protocol'],
  };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: {
        type: 'string',
        description: 'Conversational answer to the user.',
      },
      proposal: {
        type: 'object',
        additionalProperties: false,
        description:
          'Omit unless the user asked to change the architecture. The complete desired graph.',
        properties: {
          summary: { type: 'string' },
          nodes: { type: 'array', items: nodeItem },
          edges: { type: 'array', items: edgeItem },
        },
        required: ['summary', 'nodes', 'edges'],
      },
    },
    required: ['reply'],
  };
}
