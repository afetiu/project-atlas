import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiError, type AgentEvent } from '../src/extension/ai/agent';
import { BuiltinLoopAgent } from '../src/extension/ai/loop/BuiltinLoopAgent';
import type {
  LlmClient,
  LlmTurnRequest,
  LlmTurnResult,
} from '../src/extension/ai/loop/types';

type TurnScript = (request: LlmTurnRequest, onDelta: (text: string) => void) => LlmTurnResult;

/** Scripted LlmClient: each call consumes the next turn and records the request. */
function scriptedClient(turns: TurnScript[]): LlmClient & { requests: LlmTurnRequest[] } {
  const requests: LlmTurnRequest[] = [];
  let index = 0;
  return {
    providerLabel: 'MockLLM',
    requests,
    turn(request, onDelta) {
      requests.push(structuredClone(request));
      const script = turns[Math.min(index, turns.length - 1)];
      index += 1;
      return Promise.resolve(script(request, onDelta));
    },
  };
}

const finalText = (text: string): TurnScript => () => ({ text, toolCalls: [], stopReason: 'end' });

function withWorkspace(fn: (root: string) => Promise<void>): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'atlas-loop-'));
  const root = join(base, 'ws');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'console.log("hi");\n');
  return fn(root).finally(() => rmSync(base, { recursive: true, force: true }));
}

const DETECTED = JSON.stringify({
  nodes: [{ id: 'api', name: 'API', type: 'service', path: 'src' }],
  edges: [],
});

describe('BuiltinLoopAgent', () => {
  it('detect: executes tool calls, feeds results back, parses the final JSON', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({
          text: '',
          toolCalls: [{ id: 't1', name: 'Glob', arguments: { pattern: '**/*.ts' } }],
          stopReason: 'tool_use',
        }),
        finalText(DETECTED),
      ]);
      const agent = new BuiltinLoopAgent(client);
      const model = await agent.detect(root, () => undefined, new AbortController());

      assert.equal(model.nodes.length, 1);
      assert.equal(model.nodes[0].id, 'api');
      // The second request must carry the executed tool result.
      const second = client.requests[1];
      const toolResult = second.messages.at(-1);
      assert.equal(toolResult?.type, 'tool_result');
      assert.match((toolResult as { output: string }).output, /src\/index\.ts/);
      // Detection requests structured output and read-only tools.
      assert.ok(client.requests[0].jsonSchema);
      assert.deepEqual(
        client.requests[0].tools.map((tool) => tool.name),
        ['Read', 'Glob', 'Grep'],
      );
    }));

  it('detect: accepts a fenced JSON payload', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([finalText('Here you go:\n```json\n' + DETECTED + '\n```')]);
      const model = await new BuiltinLoopAgent(client).detect(root, () => undefined, new AbortController());
      assert.equal(model.nodes[0].id, 'api');
    }));

  it('detect: non-JSON and zero-node results are failures, not silent wipes', () =>
    withWorkspace(async (root) => {
      const bad = new BuiltinLoopAgent(scriptedClient([finalText('I could not analyze this.')]));
      await assert.rejects(bad.detect(root, () => undefined, new AbortController()), (error: AiError) => {
        assert.equal(error.code, 'failed');
        return true;
      });

      const empty = new BuiltinLoopAgent(
        scriptedClient([finalText(JSON.stringify({ nodes: [], edges: [] }))]),
      );
      await assert.rejects(empty.detect(root, () => undefined, new AbortController()), (error: AiError) => {
        assert.equal(error.code, 'failed');
        assert.match(error.message, /no components/);
        return true;
      });
    }));

  it('generateCode: writes through guarded tools, collects touched files, emits events', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({
          text: 'Creating the cache module.',
          toolCalls: [
            { id: 'w1', name: 'Write', arguments: { file_path: 'src/cache.ts', content: 'export {};\n' } },
          ],
          stopReason: 'tool_use',
        }),
        finalText('Added a cache module.'),
      ]);
      const events: AgentEvent[] = [];
      const emptyDelta = {
        addedNodes: [],
        removedNodes: [],
        updatedNodes: [],
        addedEdges: [],
        removedEdges: [],
        updatedEdges: [],
        addedGroups: [],
        removedGroups: [],
        updatedGroups: [],
      };
      const result = await new BuiltinLoopAgent(client).generateCode(
        root,
        emptyDelta,
        { version: 1, nodes: [], edges: [], groups: [] },
        undefined,
        (event) => events.push(event),
        new AbortController(),
      );

      assert.equal(result.summary, 'Added a cache module.');
      assert.equal(result.touchedFiles.length, 1);
      assert.ok(existsSync(join(root, 'src', 'cache.ts')));
      assert.ok(events.some((e) => e.kind === 'tool' && e.name === 'Write' && e.detail === 'src/cache.ts'));
      assert.ok(events.some((e) => e.kind === 'assistant' && /cache module/i.test(e.text)));
    }));

  it('rejects an unknown tool with a recoverable error result — there is no shell', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({
          text: '',
          toolCalls: [{ id: 'b1', name: 'Bash', arguments: { command: 'rm -rf /' } }],
          stopReason: 'tool_use',
        }),
        finalText('Understood, no shell available.'),
      ]);
      const response = await new BuiltinLoopAgent(client).chat(
        root,
        { version: 1, nodes: [], edges: [], groups: [] },
        [],
        'try something',
        () => undefined,
        new AbortController(),
      );
      assert.match(response.reply, /no shell/i);
      const feedback = client.requests[1].messages.at(-1);
      assert.equal(feedback?.type, 'tool_result');
      assert.equal((feedback as { isError?: boolean }).isError, true);
      assert.match((feedback as { output: string }).output, /Unknown tool "Bash"/);
    }));

  it('chat: streams deltas, sends history as structured messages, parses proposals', () =>
    withWorkspace(async (root) => {
      const proposal = '```atlas-proposal\n' + DETECTED.replace('"edges": []', '"edges": [], "summary": "x"') + '\n```';
      const client = scriptedClient([
        (_request, onDelta) => {
          onDelta('Sure — ');
          onDelta('done.');
          return { text: `Sure — done.\n${proposal}`, toolCalls: [], stopReason: 'end' };
        },
      ]);
      const streamed: string[] = [];
      const response = await new BuiltinLoopAgent(client).chat(
        root,
        { version: 1, nodes: [], edges: [], groups: [] },
        [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
        'add an api service',
        (token) => streamed.push(token),
        new AbortController(),
      );

      assert.equal(streamed.join(''), 'Sure — done.');
      assert.equal(response.reply, 'Sure — done.');
      assert.ok(response.proposal);
      const request = client.requests[0];
      assert.equal(request.messages.length, 3);
      assert.deepEqual(
        request.messages.map((m) => m.type),
        ['user', 'assistant', 'user'],
      );
      assert.ok(request.system && /architecture copilot/i.test(request.system));
      assert.equal(request.stream, true);
    }));

  it('cancellation: an abort surfaces as AiError("cancelled")', () =>
    withWorkspace(async (root) => {
      const controller = new AbortController();
      const client = scriptedClient([
        () => {
          controller.abort();
          throw new Error('The operation was aborted');
        },
      ]);
      await assert.rejects(
        new BuiltinLoopAgent(client).chat(
          root,
          { version: 1, nodes: [], edges: [], groups: [] },
          [],
          'hi',
          () => undefined,
          controller,
        ),
        (error: AiError) => {
          assert.equal(error.code, 'cancelled');
          return true;
        },
      );
    }));

  it('watchdog: a hung provider is aborted and reported as cancelled', () =>
    withWorkspace(async (root) => {
      const hanging: LlmClient = {
        providerLabel: 'MockLLM',
        turn: (_request, _onDelta, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      };
      const agent = new BuiltinLoopAgent(hanging, { detectMs: 30, chatMs: 30, codegenMs: 30 });
      await assert.rejects(
        agent.chat(
          root,
          { version: 1, nodes: [], edges: [], groups: [] },
          [],
          'hi',
          () => undefined,
          new AbortController(),
        ),
        (error: AiError) => {
          assert.equal(error.code, 'cancelled');
          return true;
        },
      );
    }));

  it('a truncated (length-limited) final answer is a failure, not a partial result', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({ text: '{"nodes": [', toolCalls: [], stopReason: 'length' }),
      ]);
      await assert.rejects(
        new BuiltinLoopAgent(client).detect(root, () => undefined, new AbortController()),
        (error: AiError) => {
          assert.equal(error.code, 'failed');
          assert.match(error.message, /length limit/);
          return true;
        },
      );
    }));

  it('round cap: a model that never stops calling tools fails cleanly', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({
          text: '',
          toolCalls: [{ id: 'g', name: 'Glob', arguments: { pattern: '*.ts' } }],
          stopReason: 'tool_use',
        }),
      ]);
      await assert.rejects(
        new BuiltinLoopAgent(client).chat(
          root,
          { version: 1, nodes: [], edges: [], groups: [] },
          [],
          'loop forever',
          () => undefined,
          new AbortController(),
        ),
        (error: AiError) => {
          assert.equal(error.code, 'failed');
          assert.match(error.message, /tool rounds/);
          return true;
        },
      );
    }));

  it('malformed tool arguments produce a recoverable tool error, not a crash', () =>
    withWorkspace(async (root) => {
      const client = scriptedClient([
        () => ({
          text: '',
          // A provider that failed to parse arguments passes {} per the contract.
          toolCalls: [{ id: 'r1', name: 'Read', arguments: {} }],
          stopReason: 'tool_use',
        }),
        finalText('Recovered.'),
      ]);
      const response = await new BuiltinLoopAgent(client).chat(
        root,
        { version: 1, nodes: [], edges: [], groups: [] },
        [],
        'read something',
        () => undefined,
        new AbortController(),
      );
      assert.equal(response.reply, 'Recovered.');
      const feedback = client.requests[1].messages.at(-1);
      assert.equal((feedback as { isError?: boolean }).isError, true);
    }));
});
