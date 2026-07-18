import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiError } from '../src/extension/ai/agent';
import { claudeCliAvailable, decideEngine } from '../src/extension/ai/agentFactory';
import type { AiProviderId } from '../src/extension/ai/AuthProvider';

function keys(...configured: AiProviderId[]) {
  const order: AiProviderId[] = ['anthropic', 'openai', 'gemini'];
  return {
    hasKey: (provider: AiProviderId) => Promise.resolve(configured.includes(provider)),
    firstConfigured: () =>
      Promise.resolve(order.find((provider) => configured.includes(provider))),
  };
}

describe('decideEngine resolution matrix', () => {
  it('auto prefers the claude CLI over any stored key', async () => {
    const engine = await decideEngine({
      setting: 'auto',
      cliAvailable: true,
      ...keys('anthropic', 'openai', 'gemini'),
    });
    assert.equal(engine, 'claude-code');
  });

  it('auto without the CLI picks the first configured key in priority order', async () => {
    assert.equal(
      await decideEngine({ setting: 'auto', cliAvailable: false, ...keys('openai', 'gemini') }),
      'openai',
    );
    assert.equal(
      await decideEngine({ setting: 'auto', cliAvailable: false, ...keys('gemini') }),
      'gemini',
    );
  });

  it('auto with nothing configured fails with setup guidance', async () => {
    await assert.rejects(
      decideEngine({ setting: 'auto', cliAvailable: false, ...keys() }),
      (error: AiError) => {
        assert.equal(error.code, 'auth');
        assert.match(error.message, /Set AI API Key/);
        return true;
      },
    );
  });

  it('an explicit provider wins even when the CLI is available', async () => {
    assert.equal(
      await decideEngine({ setting: 'gemini', cliAvailable: true, ...keys('anthropic', 'gemini') }),
      'gemini',
    );
  });

  it('an explicit provider without its key is an auth error naming the provider', async () => {
    await assert.rejects(
      decideEngine({ setting: 'openai', cliAvailable: true, ...keys('anthropic') }),
      (error: AiError) => {
        assert.equal(error.code, 'auth');
        assert.match(error.message, /OpenAI/);
        return true;
      },
    );
  });

  it('claude-code requires the CLI', async () => {
    assert.equal(
      await decideEngine({ setting: 'claude-code', cliAvailable: true, ...keys() }),
      'claude-code',
    );
    await assert.rejects(
      decideEngine({ setting: 'claude-code', cliAvailable: false, ...keys('anthropic') }),
      (error: AiError) => {
        assert.equal(error.code, 'auth');
        assert.match(error.message, /claude CLI was not found/);
        return true;
      },
    );
  });

  it('an unknown setting value behaves like auto', async () => {
    assert.equal(
      await decideEngine({ setting: 'something-new', cliAvailable: false, ...keys('anthropic') }),
      'anthropic',
    );
  });
});

describe('claudeCliAvailable', () => {
  it('honors an explicit path and probes PATH per platform', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-cli-'));
    try {
      const exe = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
      writeFileSync(exe, '');

      assert.equal(claudeCliAvailable(exe), true);
      assert.equal(claudeCliAvailable(join(dir, 'missing')), false);
      assert.equal(claudeCliAvailable(undefined, dir, process.platform), true);
      assert.equal(claudeCliAvailable(undefined, join(dir, 'nope'), process.platform), false);
      assert.equal(claudeCliAvailable(undefined, undefined, process.platform), claudeCliAvailable(undefined));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
