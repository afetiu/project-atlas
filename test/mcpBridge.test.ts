import assert from 'node:assert/strict';
import { test } from 'node:test';

import { McpBridge } from '../src/extension/mcp/McpBridge';

test('hasServer reflects the registry', () => {
  const bridge = new McpBridge({ postgres: { command: 'echo' } });
  assert.equal(bridge.hasServer('postgres'), true);
  assert.equal(bridge.hasServer('redis'), false);
});

test('setRegistry updates which servers are known', () => {
  const bridge = new McpBridge({});
  assert.equal(bridge.hasServer('github'), false);
  bridge.setRegistry({ github: { command: 'echo' } });
  assert.equal(bridge.hasServer('github'), true);
});

test('listTools rejects for an unconfigured server (no spawn)', async () => {
  const bridge = new McpBridge({});
  await assert.rejects(() => bridge.listTools('ghost'), /No MCP server named "ghost"/);
});
