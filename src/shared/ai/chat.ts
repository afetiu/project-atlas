/**
 * Contract for the in-canvas AI conversation.
 *
 * A chat turn returns a natural-language `reply` and, optionally, a `proposal`:
 * a complete desired architecture the user can review and apply. Returning the
 * full target graph (rather than a patch) keeps the contract simple and lets
 * the existing diff engine compute exactly what changed.
 */

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

/** Fenced block the model appends when it wants to propose an architecture. */
export const PROPOSAL_FENCE = 'atlas-proposal';

/** Defensive upper bound so a runaway proposal can't flood the canvas. */
export const MAX_PROPOSAL_NODES = 500;

const FENCE_RE = /```atlas-proposal\s*([\s\S]*?)```/g;

/**
 * Parse a streamed assistant reply: the prose is the answer, and an optional
 * trailing ```atlas-proposal``` JSON block carries a proposed architecture.
 * Using a fenced block (instead of forcing structured output) lets the reply
 * stream token-by-token.
 *
 * Robust to the model emitting more than one fence (e.g. a throwaway draft then
 * the real one): every fence is stripped from the prose, and the *last* fence
 * that parses into a usable proposal wins.
 */
export function parseChatReply(text: string): ChatResponse {
  const matches = [...text.matchAll(FENCE_RE)];
  if (matches.length === 0) {
    return { reply: text.trim() };
  }

  let reply = text;
  for (const m of matches) {
    reply = reply.replace(m[0], '');
  }
  reply = reply.trim();

  // Prefer the last well-formed proposal; ignore empty/malformed earlier ones.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const proposal = parseProposalBlock(matches[i][1]);
    if (proposal) {
      return { reply, proposal };
    }
  }
  return { reply };
}

function parseProposalBlock(body: string): ChatProposal | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const obj = JSON.parse(trimmed) as { summary?: unknown; nodes?: unknown; edges?: unknown };
    if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
      return null;
    }
    const nodes = (obj.nodes as DetectedNode[]).slice(0, MAX_PROPOSAL_NODES);
    const edges = Array.isArray(obj.edges)
      ? (obj.edges as DetectedEdge[]).slice(0, MAX_PROPOSAL_NODES * 4)
      : [];
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : 'Proposed change',
      nodes,
      edges,
    };
  } catch {
    return null;
  }
}

/** Strip a (possibly partial) trailing proposal block for live display. */
export function stripProposalBlock(text: string): string {
  const index = text.indexOf('```' + PROPOSAL_FENCE);
  return index >= 0 ? text.slice(0, index).trim() : text;
}
