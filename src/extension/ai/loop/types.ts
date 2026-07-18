/**
 * The provider-neutral LLM contract for the built-in loop.
 *
 * A provider implements exactly one thing: a single model turn — full message
 * history and tool schemas in, streamed text plus parsed tool calls out. The
 * loop (BuiltinLoopAgent) owns everything else: tool execution, message
 * accumulation, watchdogs, and error semantics. This keeps each provider a
 * thin translation layer over its SDK.
 */

import type { ToolDefinition } from '../tools/types';

export interface LlmToolCall {
  /** Provider-assigned id, echoed back in the matching tool result. */
  id: string;
  name: string;
  /**
   * Parsed tool arguments. Providers must parse their wire format (usually a
   * JSON string) and pass `{}` when parsing fails — the tool then returns a
   * validation error the model can recover from.
   */
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string; toolCalls: LlmToolCall[] }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string; isError?: boolean };

export interface LlmTurnRequest {
  system?: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  /**
   * When set, the final (tool-call-free) assistant message must be JSON
   * conforming to this schema. Providers use their native structured-output
   * mechanism where available.
   */
  jsonSchema?: Record<string, unknown>;
  /** Stream text deltas through onDelta as they arrive. */
  stream: boolean;
}

export interface LlmTurnResult {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: 'end' | 'tool_use' | 'length' | 'other';
}

export interface LlmClient {
  /** Human-readable provider name for status and error messages (e.g. "OpenAI"). */
  readonly providerLabel: string;
  turn(
    request: LlmTurnRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<LlmTurnResult>;
}
