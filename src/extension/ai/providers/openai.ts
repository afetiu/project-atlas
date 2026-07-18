/**
 * OpenAI provider for the built-in loop, over the Chat Completions API with
 * function calling and json_schema response format. Streaming is accumulated
 * with a pure reducer so the chunk handling is unit-testable.
 */

import OpenAI from 'openai';

import { AiError } from '../agent';
import type { LlmClient, LlmTurnRequest, LlmTurnResult } from '../loop/types';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6';

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/** Convert a provider-neutral turn request into Chat Completions params. */
export function toOpenAiParams(request: LlmTurnRequest, model: string): ChatParams {
  const messages: ChatMessage[] = [];
  if (request.system) {
    messages.push({ role: 'system', content: request.system });
  }
  for (const message of request.messages) {
    if (message.type === 'user') {
      messages.push({ role: 'user', content: message.text });
    } else if (message.type === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.output });
    }
  }

  return {
    model,
    stream: true,
    messages,
    ...(request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    ...(request.jsonSchema
      ? {
          response_format: {
            type: 'json_schema' as const,
            json_schema: { name: 'atlas_result', schema: request.jsonSchema },
          },
        }
      : {}),
  };
}

interface ToolCallDraft {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface StreamState {
  text: string;
  toolCalls: ToolCallDraft[];
  finishReason: string | null;
}

export function newStreamState(): StreamState {
  return { text: '', toolCalls: [], finishReason: null };
}

/** Fold one streamed chunk into the state; returns any new visible text. */
export function applyChunk(state: StreamState, chunk: ChatChunk): string {
  const choice = chunk.choices?.[0];
  if (!choice) {
    return '';
  }
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
  const delta = choice.delta;
  let visible = '';
  if (typeof delta?.content === 'string' && delta.content.length > 0) {
    state.text += delta.content;
    visible = delta.content;
  }
  for (const fragment of delta?.tool_calls ?? []) {
    const index = fragment.index ?? 0;
    while (state.toolCalls.length <= index) {
      state.toolCalls.push({ id: '', name: '', argumentsJson: '' });
    }
    const draft = state.toolCalls[index];
    if (fragment.id) {
      draft.id = fragment.id;
    }
    if (fragment.function?.name) {
      draft.name += fragment.function.name;
    }
    if (fragment.function?.arguments) {
      draft.argumentsJson += fragment.function.arguments;
    }
  }
  return visible;
}

export function finalizeState(state: StreamState): LlmTurnResult {
  const toolCalls = state.toolCalls
    .filter((draft) => draft.name.length > 0)
    .map((draft) => ({
      id: draft.id || draft.name,
      name: draft.name,
      arguments: parseArguments(draft.argumentsJson),
    }));
  return {
    text: state.text,
    toolCalls,
    stopReason: mapFinishReason(state.finishReason, toolCalls.length > 0),
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Contract: unparseable arguments become {} so the tool returns a
    // validation error the model can recover from.
    return {};
  }
}

function mapFinishReason(reason: string | null, hasToolCalls: boolean): LlmTurnResult['stopReason'] {
  if (hasToolCalls) {
    return 'tool_use';
  }
  switch (reason) {
    case 'stop':
      return 'end';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'other';
  }
}

/** Abort-like errors pass through; everything else becomes an AiError. */
export function mapOpenAiError(error: unknown): Error {
  if (error instanceof AiError) {
    return error;
  }
  if (error instanceof Error && (error.name === 'APIUserAbortError' || /\babort/i.test(error.message))) {
    return error;
  }
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 401 || status === 403) {
    return new AiError('auth', 'OpenAI authentication failed. Check your API key.');
  }
  if (status === 429) {
    return new AiError('failed', 'OpenAI rate limit reached. Try again shortly.');
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AiError('failed', `OpenAI request failed: ${message}`);
}

export class OpenAiProvider implements LlmClient {
  readonly providerLabel = 'OpenAI';
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string = DEFAULT_OPENAI_MODEL) {
    this.client = new OpenAI({ apiKey });
  }

  async turn(
    request: LlmTurnRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<LlmTurnResult> {
    try {
      const stream = await this.client.chat.completions.create(
        toOpenAiParams(request, this.model),
        { signal },
      );
      const state = newStreamState();
      for await (const chunk of stream) {
        const visible = applyChunk(state, chunk);
        if (visible && request.stream) {
          onDelta(visible);
        }
      }
      return finalizeState(state);
    } catch (error) {
      throw mapOpenAiError(error);
    }
  }
}
