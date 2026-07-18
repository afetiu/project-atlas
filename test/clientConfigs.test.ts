import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';

import {
  applyCodexToml,
  mcpClientTargets,
  type McpServerSpec,
} from '../src/extension/mcp/clientConfigs';

const SPEC: McpServerSpec = {
  serverPath: 'C:\\ext\\dist\\mcp-server.mjs',
  workspacePath: 'C:\\repo',
};

function targetOf(id: string) {
  const target = mcpClientTargets('C:\\repo', 'C:\\home').find((t) => t.id === id);
  assert.ok(target, `missing target ${id}`);
  return target!;
}

describe('mcp client configs', () => {
  it('covers all five clients with the right scopes and paths', () => {
    const targets = mcpClientTargets('C:\\repo', 'C:\\home');
    assert.deepEqual(
      targets.map((t) => t.id),
      ['claude-code', 'cursor', 'windsurf', 'gemini-cli', 'codex'],
    );
    assert.equal(targetOf('claude-code').configPath, join('C:\\repo', '.mcp.json'));
    assert.equal(targetOf('cursor').configPath, join('C:\\repo', '.cursor', 'mcp.json'));
    assert.equal(
      targetOf('windsurf').configPath,
      join('C:\\home', '.codeium', 'windsurf', 'mcp_config.json'),
    );
    assert.equal(targetOf('gemini-cli').configPath, join('C:\\repo', '.gemini', 'settings.json'));
    assert.equal(targetOf('codex').configPath, join('C:\\home', '.codex', 'config.toml'));
    assert.equal(targetOf('windsurf').global, true);
    assert.equal(targetOf('cursor').global, false);
  });

  it('creates a fresh JSON config with the atlas entry', () => {
    const text = targetOf('claude-code').apply('', SPEC);
    const parsed = JSON.parse(text);
    assert.deepEqual(parsed.mcpServers.atlas, {
      command: 'node',
      args: [SPEC.serverPath],
      env: { ATLAS_WORKSPACE: SPEC.workspacePath },
    });
  });

  it('merges into existing JSON without touching other servers or settings', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { postgres: { command: 'npx', args: ['-y', 'pg-mcp'] } },
    });
    const parsed = JSON.parse(targetOf('gemini-cli').apply(existing, SPEC));
    assert.equal(parsed.theme, 'dark');
    assert.deepEqual(parsed.mcpServers.postgres, { command: 'npx', args: ['-y', 'pg-mcp'] });
    assert.equal(parsed.mcpServers.atlas.command, 'node');
  });

  it('re-registering updates the atlas entry idempotently', () => {
    const once = targetOf('cursor').apply('', SPEC);
    const twice = targetOf('cursor').apply(once, { ...SPEC, serverPath: 'D:\\new\\server.mjs' });
    const parsed = JSON.parse(twice);
    assert.deepEqual(parsed.mcpServers.atlas.args, ['D:\\new\\server.mjs']);
    assert.equal(Object.keys(parsed.mcpServers).length, 1);
  });

  it('refuses to clobber a corrupt JSON file', () => {
    assert.throws(() => targetOf('claude-code').apply('{not json', SPEC), /not valid JSON/);
  });

  it('appends a codex TOML section without touching existing content', () => {
    const existing = 'model = "gpt-5.6"\n\n[mcp_servers.linear]\ncommand = "npx"\n';
    const updated = applyCodexToml(existing, SPEC);
    assert.match(updated, /^model = "gpt-5\.6"/);
    assert.match(updated, /\[mcp_servers\.linear\]/);
    assert.match(updated, /\[mcp_servers\.atlas\]/);
    assert.match(updated, /ATLAS_WORKSPACE = "C:\\\\repo"/);
  });

  it('replaces an existing codex atlas section instead of duplicating it', () => {
    const once = applyCodexToml('', SPEC);
    const twice = applyCodexToml(once, { ...SPEC, serverPath: 'D:\\new\\server.mjs' });
    assert.equal(twice.match(/\[mcp_servers\.atlas\]/g)?.length, 1);
    assert.match(twice, /D:\\\\new\\\\server\.mjs/);
    assert.doesNotMatch(twice, /C:\\\\ext/);
  });
});
