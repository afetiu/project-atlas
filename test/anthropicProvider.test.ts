import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AiError } from '../src/extension/ai/agent';
import {
  DEFAULT_ANTHROPIC_MODEL,
  fromAnthropicMessage,
  mapAnthropicError,
  toAnthropicParams,
} from '../src/extension/ai/providers/anthropic';
import type { LlmTurnRequest } from '../src/extension/ai/loop/types';

const READ_TOOL = {
  name: 'Read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
};

function baseRequest(overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest {
  return {
    system: 'be helpful',
    messages: [{ type: 'user', text: 'hello' }],
    tools: [READ_TOOL],
    stream: false,
    ...overrides,
  };
}

describe('anthropic provider request building', () => {
  it('maps system, tools, model, and adaptive thinking', () => {
    const params = toAnthropicParams(baseRequest(), DEFAULT_ANTHROPIC_MODEL);
    assert.equal(params.model, 'claude-opus-4-8');
    assert.equal(params.system, 'be helpful');
    assert.deepEqual(params.thinking, { type: 'adaptive' });
    assert.equal(params.tools?.length, 1);
    assert.equal(params.tools?.[0].name, 'Read');
    assert.equal(params.messages.length, 1);
  });

  it('merges consecutive tool results into a single user message', () => {
    const params = toAnthropicParams(
      baseRequest({
        messages: [
          { type: 'user', text: 'go' },
          {
            type: 'assistant',
            text: 'working',
            toolCalls: [
              { id: 'a', name: 'Read', arguments: { file_path: 'x' } },
              { id: 'b', name: 'Read', arguments: { file_path: 'y' } },
            ],
          },
          { type: 'tool_result', toolCallId: 'a', toolName: 'Read', output: 'ax' },
          { type: 'tool_result', toolCallId: 'b', toolName: 'Read', output: 'by', isError: true },
        ],
      }),
      DEFAULT_ANTHROPIC_MODEL,
    );

    assert.equal(params.messages.length, 3);
    const [, assistant, results] = params.messages;
    assert.equal(assistant.role, 'assistant');
    const blocks = assistant.content as Array<{ type: string }>;
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['text', 'tool_use', 'tool_use'],
    );
    assert.equal(results.role, 'user');
    const resultBlocks = results.content as Array<{ type: string; tool_use_id: string; is_error?: boolean }>;
    assert.equal(resultBlocks.length, 2);
    assert.equal(resultBlocks[0].tool_use_id, 'a');
    assert.equal(resultBlocks[1].is_error, true);
  });

  it('adds structured output config only when a schema is requested', () => {
    const plain = toAnthropicParams(baseRequest(), DEFAULT_ANTHROPIC_MODEL);
    assert.equal((plain as Record<string, unknown>).output_config, undefined);

    const schema = { type: 'object', properties: {} };
    const structured = toAnthropicParams(baseRequest({ jsonSchema: schema }), DEFAULT_ANTHROPIC_MODEL);
    assert.deepEqual((structured as Record<string, unknown>).output_config, {
      format: { type: 'json_schema', schema },
    });
  });
});

describe('anthropic provider response mapping', () => {
  it('extracts text, tool calls, and the stop reason', () => {
    const result = fromAnthropicMessage({
      content: [
        { type: 'text', text: 'Let me check. ' },
        { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'x' } },
      ],
      stop_reason: 'tool_use',
    });
    assert.equal(result.text, 'Let me check. ');
    assert.deepEqual(result.toolCalls, [{ id: 't1', name: 'Grep', arguments: { pattern: 'x' } }]);
    assert.equal(result.stopReason, 'tool_use');
  });

  it('maps terminal and truncation stop reasons', () => {
    assert.equal(fromAnthropicMessage({ content: [], stop_reason: 'end_turn' }).stopReason, 'end');
    assert.equal(fromAnthropicMessage({ content: [], stop_reason: 'max_tokens' }).stopReason, 'length');
    assert.equal(fromAnthropicMessage({ content: [], stop_reason: 'refusal' }).stopReason, 'other');
  });

  it('defends against non-object tool inputs', () => {
    const result = fromAnthropicMessage({
      content: [{ type: 'tool_use', id: 't1', name: 'Read', input: 'not-an-object' }],
      stop_reason: 'tool_use',
    });
    assert.deepEqual(result.toolCalls[0].arguments, {});
  });
});

describe('anthropic provider error mapping', () => {
  it('classifies auth, rate limit, and generic failures', () => {
    const auth = mapAnthropicError(Object.assign(new Error('unauthorized'), { status: 401 }));
    assert.ok(auth instanceof AiError && auth.code === 'auth');

    const forbidden = mapAnthropicError(Object.assign(new Error('forbidden'), { status: 403 }));
    assert.ok(forbidden instanceof AiError && forbidden.code === 'auth');

    const rate = mapAnthropicError(Object.assign(new Error('too many'), { status: 429 }));
    assert.ok(rate instanceof AiError && rate.code === 'failed' && /rate limit/i.test(rate.message));

    const generic = mapAnthropicError(new Error('boom'));
    assert.ok(generic instanceof AiError && generic.code === 'failed' && /boom/.test(generic.message));
  });

  it('passes abort errors through untouched for the loop to classify', () => {
    const abort = new Error('Request was aborted.');
    abort.name = 'APIUserAbortError';
    assert.equal(mapAnthropicError(abort), abort);
  });
});
