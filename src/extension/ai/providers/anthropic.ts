/**
 * Anthropic direct-API provider for the built-in loop.
 *
 * Unlike the ClaudeSdkAgent path this needs no `claude` CLI — just an API key —
 * which is what makes the AI buttons work in Cursor and other environments
 * without Claude Code. Uses `claude-opus-4-8` with adaptive thinking by
 * default; detection constrains the final message via structured outputs.
 */

import Anthropic from '@anthropic-ai/sdk';

import { AiError } from '../agent';
import type { LlmClient, LlmMessage, LlmTurnRequest, LlmTurnResult } from '../loop/types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

const MAX_TOKENS = 64_000;

type AnthropicParams = Parameters<Anthropic['messages']['stream']>[0];

/** Convert a provider-neutral turn request into Anthropic Messages params. */
export function toAnthropicParams(request: LlmTurnRequest, model: string): AnthropicParams {
  const messages: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      // All results for one assistant turn must land in a single user message.
      messages.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const message of request.messages) {
    if (message.type === 'tool_result') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.output,
        ...(message.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flushToolResults();
    if (message.type === 'user') {
      messages.push({ role: 'user', content: message.text });
    } else {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.text) {
        content.push({ type: 'text', text: message.text });
      }
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      if (content.length > 0) {
        messages.push({ role: 'assistant', content });
      }
    }
  }
  flushToolResults();

  const params: AnthropicParams = {
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    messages,
    ...(request.system ? { system: request.system } : {}),
    ...(request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
          })),
        }
      : {}),
  };
  if (request.jsonSchema) {
    (params as Record<string, unknown>).output_config = {
      format: { type: 'json_schema', schema: request.jsonSchema },
    };
  }
  return params;
}

/** Convert a final Anthropic message into the provider-neutral result. */
export function fromAnthropicMessage(message: {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string | null;
}): LlmTurnResult {
  let text = '';
  const toolCalls: LlmTurnResult['toolCalls'] = [];
  for (const block of message.content) {
    if (block.type === 'text' && block.text) {
      text += block.text;
    } else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: isRecord(block.input) ? block.input : {},
      });
    }
  }
  return { text, toolCalls, stopReason: mapStopReason(message.stop_reason) };
}

function mapStopReason(reason: string | null): LlmTurnResult['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'length';
    default:
      return 'other';
  }
}

/**
 * Map an Anthropic SDK failure to an AiError. Abort-like errors are returned
 * unchanged so the loop can classify them as a cancellation.
 */
export function mapAnthropicError(error: unknown): Error {
  if (error instanceof AiError) {
    return error;
  }
  if (error instanceof Error && (error.name === 'APIUserAbortError' || /\babort/i.test(error.message))) {
    return error;
  }
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  if (status === 401 || status === 403) {
    return new AiError('auth', 'Anthropic authentication failed. Check your API key.');
  }
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) {
    return new AiError('failed', 'Anthropic rate limit reached. Try again shortly.');
  }
  return new AiError('failed', `Anthropic request failed: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AnthropicProvider implements LlmClient {
  readonly providerLabel = 'Anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string = DEFAULT_ANTHROPIC_MODEL) {
    this.client = new Anthropic({ apiKey });
  }

  async turn(
    request: LlmTurnRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<LlmTurnResult> {
    try {
      const stream = this.client.messages.stream(toAnthropicParams(request, this.model), { signal });
      if (request.stream) {
        stream.on('text', onDelta);
      }
      const message = await stream.finalMessage();
      return fromAnthropicMessage(message);
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

/** Re-export for tests and the shared LlmMessage type surface. */
export type { LlmMessage };
