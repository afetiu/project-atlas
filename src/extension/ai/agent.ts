/**
 * The provider-neutral contract for Atlas's AI layer.
 *
 * Every implementation — the Claude Agent SDK wrapper or the built-in provider
 * loop — exposes the same three jobs (detect, chat, generate) with identical
 * progress, cancellation, and error semantics, so the panel and commands never
 * care which engine is running.
 */

import type { ChatResponse, ChatTurn } from '../../shared/ai/chat';
import type { ModelDelta } from '../../shared/model/diff';
import type { ArchitectureModel } from '../../shared/model/types';

export type AgentEvent =
  | { kind: 'status'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; detail: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export type AiErrorCode = 'auth' | 'cancelled' | 'failed';

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export interface CodegenResult {
  summary: string;
  sessionId?: string;
  /** Files the agent created or edited, for an optional revert. */
  touchedFiles: string[];
}

export interface ArchitectureAgent {
  /** Analyze a repository and return a normalized, laid-out architecture model. */
  detect(
    cwd: string,
    onEvent: AgentEventHandler,
    abortController: AbortController,
    previous?: ArchitectureModel,
  ): Promise<ArchitectureModel>;

  /** Run one conversational turn, optionally returning a proposed model. */
  chat(
    cwd: string,
    model: ArchitectureModel,
    history: ChatTurn[],
    message: string,
    onToken: (text: string) => void,
    abortController: AbortController,
  ): Promise<ChatResponse>;

  /** Generate code that realizes an architecture change, streaming progress. */
  generateCode(
    cwd: string,
    delta: ModelDelta,
    model: ArchitectureModel,
    instruction: string | undefined,
    onEvent: AgentEventHandler,
    abortController: AbortController,
  ): Promise<CodegenResult>;
}
