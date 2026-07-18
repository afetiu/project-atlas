import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AiError } from '../src/extension/ai/agent';
import {
  DEFAULT_GEMINI_MODEL,
  finalizeGeminiState,
  foldGeminiChunk,
  mapGeminiError,
  newGeminiState,
  toGeminiRequest,
} from '../src/extension/ai/providers/gemini';
import type { LlmTurnRequest } from '../src/extension/ai/loop/types';

const TOOL = {
  name: 'Read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
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

describe('gemini provider request building', () => {
  it('maps roles, function declarations, and merges tool responses into one turn', () => {
    const { model, contents, config } = toGeminiRequest(
      baseRequest({
        messages: [
          { type: 'user', text: 'go' },
          {
            type: 'assistant',
            text: 'checking',
            toolCalls: [
              { id: 'a', name: 'Read', arguments: { file_path: 'x' } },
              { id: 'b', name: 'Read', arguments: { file_path: 'y' } },
            ],
          },
          { type: 'tool_result', toolCallId: 'a', toolName: 'Read', output: 'ax' },
          { type: 'tool_result', toolCallId: 'b', toolName: 'Read', output: 'oops', isError: true },
        ],
      }),
      DEFAULT_GEMINI_MODEL,
    );

    assert.equal(model, 'gemini-flash-latest');
    assert.deepEqual(
      contents.map((content) => content.role),
      ['user', 'model', 'user'],
    );
    const modelParts = contents[1].parts;
    assert.equal(modelParts[0].text, 'checking');
    assert.equal(modelParts[1].functionCall?.name, 'Read');
    const responses = contents[2].parts;
    assert.equal(responses.length, 2);
    assert.deepEqual(responses[0].functionResponse?.response, { output: 'ax' });
    assert.deepEqual(responses[1].functionResponse?.response, { error: 'oops' });
    const declarations = (config.tools as Array<{ functionDeclarations: Array<{ name: string }> }>)[0]
      .functionDeclarations;
    assert.equal(declarations[0].name, 'Read');
    assert.equal(config.systemInstruction, 'be helpful');
  });

  it('uses native JSON schema output only when no tools are active', () => {
    const schema = { type: 'object' };
    const native = toGeminiRequest(baseRequest({ tools: [], jsonSchema: schema }), DEFAULT_GEMINI_MODEL);
    assert.equal(native.config.responseMimeType, 'application/json');
    assert.deepEqual(native.config.responseJsonSchema, schema);

    const withTools = toGeminiRequest(baseRequest({ jsonSchema: schema }), DEFAULT_GEMINI_MODEL);
    assert.equal(withTools.config.responseMimeType, undefined);
    assert.match(String(withTools.config.systemInstruction), /JSON Schema/);
    assert.match(String(withTools.config.systemInstruction), /"type":"object"/);
  });
});

describe('gemini provider stream folding', () => {
  it('accumulates text and function calls, assigning ids when missing', () => {
    const state = newGeminiState();
    const visible = foldGeminiChunk(state, {
      candidates: [{ content: { parts: [{ text: 'Working… ' }] } }],
    });
    assert.equal(visible, 'Working… ');
    foldGeminiChunk(state, {
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'Read', args: { file_path: 'x' } } }] },
          finishReason: 'STOP',
        },
      ],
    });
    const result = finalizeGeminiState(state);
    assert.equal(result.text, 'Working… ');
    assert.deepEqual(result.toolCalls, [
      { id: 'atlas_call_1', name: 'Read', arguments: { file_path: 'x' } },
    ]);
    // Function calls dominate the stop mapping even when finishReason is STOP.
    assert.equal(result.stopReason, 'tool_use');
  });

  it('maps terminal and truncation finish reasons', () => {
    const done = newGeminiState();
    foldGeminiChunk(done, { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] });
    assert.equal(finalizeGeminiState(done).stopReason, 'end');

    const truncated = newGeminiState();
    foldGeminiChunk(truncated, { candidates: [{ finishReason: 'MAX_TOKENS' }] });
    assert.equal(finalizeGeminiState(truncated).stopReason, 'length');
  });
});

describe('gemini provider error mapping', () => {
  it('classifies auth, rate limit, and generic failures; aborts pass through', () => {
    const auth = mapGeminiError(new Error('API key not valid. Please pass a valid API key.'));
    assert.ok(auth instanceof AiError && auth.code === 'auth');

    const status = mapGeminiError(Object.assign(new Error('denied'), { status: 403 }));
    assert.ok(status instanceof AiError && status.code === 'auth');

    const rate = mapGeminiError(new Error('RESOURCE_EXHAUSTED: quota'));
    assert.ok(rate instanceof AiError && /rate limit/i.test(rate.message));

    const abort = new Error('This operation was aborted');
    assert.equal(mapGeminiError(abort), abort);
  });
});
