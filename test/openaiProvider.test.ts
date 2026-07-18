import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AiError } from '../src/extension/ai/agent';
import {
  DEFAULT_OPENAI_MODEL,
  applyChunk,
  finalizeState,
  mapOpenAiError,
  newStreamState,
  toOpenAiParams,
} from '../src/extension/ai/providers/openai';
import type { LlmTurnRequest } from '../src/extension/ai/loop/types';

const TOOL = {
  name: 'Glob',
  description: 'List files',
  inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
};

function baseRequest(overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest {
  return {
    system: 'be helpful',
    messages: [{ type: 'user', text: 'hello' }],
    tools: [TOOL],
    stream: false,
    ...overrides,
  };
}

/** Fabricate a streamed chunk in the Chat Completions shape. */
function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { choices: [{ delta, finish_reason: finish }] } as never;
}

describe('openai provider request building', () => {
  it('maps system prompt, tool schemas, and history roles', () => {
    const params = toOpenAiParams(
      baseRequest({
        messages: [
          { type: 'user', text: 'go' },
          {
            type: 'assistant',
            text: 'checking',
            toolCalls: [{ id: 'c1', name: 'Glob', arguments: { pattern: '*.ts' } }],
          },
          { type: 'tool_result', toolCallId: 'c1', toolName: 'Glob', output: 'a.ts' },
        ],
      }),
      DEFAULT_OPENAI_MODEL,
    );

    assert.equal(params.model, 'gpt-5.6');
    assert.equal(params.stream, true);
    assert.deepEqual(
      params.messages.map((m) => m.role),
      ['system', 'user', 'assistant', 'tool'],
    );
    const assistant = params.messages[2] as { tool_calls?: Array<{ id: string; function: { arguments: string } }> };
    assert.equal(assistant.tool_calls?.[0].id, 'c1');
    assert.equal(assistant.tool_calls?.[0].function.arguments, '{"pattern":"*.ts"}');
    const toolMsg = params.messages[3] as { tool_call_id: string; content: string };
    assert.equal(toolMsg.tool_call_id, 'c1');
    const firstTool = params.tools?.[0] as { function: { name: string } };
    assert.equal(firstTool.function.name, 'Glob');
  });

  it('requests json_schema output only when a schema is provided', () => {
    assert.equal(toOpenAiParams(baseRequest(), DEFAULT_OPENAI_MODEL).response_format, undefined);
    const schema = { type: 'object' };
    const params = toOpenAiParams(baseRequest({ jsonSchema: schema }), DEFAULT_OPENAI_MODEL);
    assert.deepEqual(params.response_format, {
      type: 'json_schema',
      json_schema: { name: 'atlas_result', schema },
    });
  });
});

describe('openai provider stream accumulation', () => {
  it('accumulates text deltas and reports visible text per chunk', () => {
    const state = newStreamState();
    assert.equal(applyChunk(state, chunk({ content: 'Hel' })), 'Hel');
    assert.equal(applyChunk(state, chunk({ content: 'lo' }, 'stop')), 'lo');
    const result = finalizeState(state);
    assert.equal(result.text, 'Hello');
    assert.equal(result.stopReason, 'end');
    assert.equal(result.toolCalls.length, 0);
  });

  it('reassembles fragmented tool calls across chunks', () => {
    const state = newStreamState();
    applyChunk(state, chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Gl' } }] }));
    applyChunk(state, chunk({ tool_calls: [{ index: 0, function: { name: 'ob', arguments: '{"patt' } }] }));
    applyChunk(state, chunk({ tool_calls: [{ index: 0, function: { arguments: 'ern":"*.ts"}' } }] }, 'tool_calls'));
    const result = finalizeState(state);
    assert.deepEqual(result.toolCalls, [
      { id: 'call_1', name: 'Glob', arguments: { pattern: '*.ts' } },
    ]);
    assert.equal(result.stopReason, 'tool_use');
  });

  it('turns unparseable tool arguments into {} per the loop contract', () => {
    const state = newStreamState();
    applyChunk(state, chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'Read', arguments: '{broken' } }] }, 'tool_calls'));
    assert.deepEqual(finalizeState(state).toolCalls[0].arguments, {});
  });

  it('maps the length finish reason to a truncation', () => {
    const state = newStreamState();
    applyChunk(state, chunk({ content: 'partial' }, 'length'));
    assert.equal(finalizeState(state).stopReason, 'length');
  });
});

describe('openai provider error mapping', () => {
  it('classifies auth and generic failures, passes aborts through', () => {
    const auth = mapOpenAiError(Object.assign(new Error('nope'), { status: 401 }));
    assert.ok(auth instanceof AiError && auth.code === 'auth');

    const generic = mapOpenAiError(new Error('kaboom'));
    assert.ok(generic instanceof AiError && /kaboom/.test(generic.message));

    const abort = new Error('Request was aborted.');
    assert.equal(mapOpenAiError(abort), abort);
  });
});
