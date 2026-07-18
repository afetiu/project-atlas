/**
 * Google Gemini provider for the built-in loop, over @google/genai with
 * function declarations and (where possible) native JSON-schema output.
 *
 * Quirk: schema-constrained responses combined with function calling are not
 * reliably supported by the Gemini API, so when a turn carries both tools and
 * a jsonSchema the schema is embedded as an instruction instead — the loop
 * already parses fenced JSON payloads for exactly this case.
 */

import { GoogleGenAI } from '@google/genai';

import { AiError } from '../agent';
import type { LlmClient, LlmTurnRequest, LlmTurnResult } from '../loop/types';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiRequest {
  model: string;
  contents: GeminiContent[];
  config: Record<string, unknown>;
}

/** Convert a provider-neutral turn request into a Gemini generateContent request. */
export function toGeminiRequest(request: LlmTurnRequest, model: string): GeminiRequest {
  const contents: GeminiContent[] = [];
  let pendingResponses: GeminiPart[] = [];

  const flushResponses = () => {
    if (pendingResponses.length > 0) {
      contents.push({ role: 'user', parts: pendingResponses });
      pendingResponses = [];
    }
  };

  for (const message of request.messages) {
    if (message.type === 'tool_result') {
      pendingResponses.push({
        functionResponse: {
          name: message.toolName,
          response: message.isError
            ? { error: message.output }
            : { output: message.output },
        },
      });
      continue;
    }
    flushResponses();
    if (message.type === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.text }] });
    } else {
      const parts: GeminiPart[] = [];
      if (message.text) {
        parts.push({ text: message.text });
      }
      for (const call of message.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
    }
  }
  flushResponses();

  const hasTools = request.tools.length > 0;
  let systemInstruction = request.system ?? '';
  const config: Record<string, unknown> = {};

  if (hasTools) {
    config.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.inputSchema,
        })),
      },
    ];
  }
  if (request.jsonSchema) {
    if (hasTools) {
      systemInstruction = [
        systemInstruction,
        'When you are done using tools, your final message must be ONLY a JSON object',
        'conforming to this JSON Schema (no prose, no code fences):',
        JSON.stringify(request.jsonSchema),
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = request.jsonSchema;
    }
  }
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  return { model, contents, config };
}

export interface GeminiStreamState {
  text: string;
  toolCalls: LlmTurnResult['toolCalls'];
  finishReason: string | null;
}

export function newGeminiState(): GeminiStreamState {
  return { text: '', toolCalls: [], finishReason: null };
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
}

/** Fold one streamed chunk into the state; returns any new visible text. */
export function foldGeminiChunk(state: GeminiStreamState, chunk: GeminiChunk): string {
  const candidate = chunk.candidates?.[0];
  if (!candidate) {
    return '';
  }
  if (candidate.finishReason) {
    state.finishReason = candidate.finishReason;
  }
  let visible = '';
  for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      state.text += part.text;
      visible += part.text;
    }
    if (part.functionCall?.name) {
      state.toolCalls.push({
        id: part.functionCall.id ?? `atlas_call_${state.toolCalls.length + 1}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }
  return visible;
}

export function finalizeGeminiState(state: GeminiStreamState): LlmTurnResult {
  return {
    text: state.text,
    toolCalls: state.toolCalls,
    stopReason: mapFinishReason(state.finishReason, state.toolCalls.length > 0),
  };
}

function mapFinishReason(reason: string | null, hasToolCalls: boolean): LlmTurnResult['stopReason'] {
  if (hasToolCalls) {
    return 'tool_use';
  }
  switch (reason) {
    case 'STOP':
      return 'end';
    case 'MAX_TOKENS':
      return 'length';
    default:
      return 'other';
  }
}

/** Abort-like errors pass through; everything else becomes an AiError. */
export function mapGeminiError(error: unknown): Error {
  if (error instanceof AiError) {
    return error;
  }
  if (error instanceof Error && /\babort/i.test(`${error.name} ${error.message}`)) {
    return error;
  }
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED/i.test(message)) {
    return new AiError('auth', 'Gemini authentication failed. Check your API key.');
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
    return new AiError('failed', 'Gemini rate limit reached. Try again shortly.');
  }
  return new AiError('failed', `Gemini request failed: ${message}`);
}

export class GeminiProvider implements LlmClient {
  readonly providerLabel = 'Gemini';
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, private readonly model: string = DEFAULT_GEMINI_MODEL) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async turn(
    request: LlmTurnRequest,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<LlmTurnResult> {
    try {
      const { model, contents, config } = toGeminiRequest(request, this.model);
      const stream = await this.ai.models.generateContentStream({
        model,
        contents: contents as never,
        config: { ...config, abortSignal: signal } as never,
      });
      const state = newGeminiState();
      for await (const chunk of stream) {
        const visible = foldGeminiChunk(state, chunk as GeminiChunk);
        if (visible && request.stream) {
          onDelta(visible);
        }
      }
      return finalizeGeminiState(state);
    } catch (error) {
      throw mapGeminiError(error);
    }
  }
}
