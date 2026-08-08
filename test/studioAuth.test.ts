import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { StandaloneAuth } from '../src/studio/StandaloneAuth';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ATLAS_CLAUDE_PATH', 'ATLAS_MODEL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe('StandaloneAuth', () => {
  it('has no key when nothing is set', async () => {
    const auth = new StandaloneAuth();
    assert.equal(await auth.getApiKey('anthropic'), undefined);
    assert.equal(await auth.firstConfiguredProvider(), undefined);
  });

  it('reads a provider key from its conventional env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
    const auth = new StandaloneAuth();
    assert.equal(await auth.getApiKey('anthropic'), 'sk-test-anthropic');
    assert.equal(await auth.firstConfiguredProvider(), 'anthropic');
  });

  it('firstConfiguredProvider respects anthropic > openai > gemini order', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    process.env.GEMINI_API_KEY = 'sk-test-gemini';
    const auth = new StandaloneAuth();
    assert.equal(await auth.firstConfiguredProvider(), 'openai');
  });

  it('gemini also accepts GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'sk-test-google';
    const auth = new StandaloneAuth();
    assert.equal(await auth.getApiKey('gemini'), 'sk-test-google');
  });

  it('buildEnv injects the resolved anthropic key without dropping the rest of process.env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
    const auth = new StandaloneAuth();
    const env = await auth.buildEnv();
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-test-anthropic');
    assert.equal(env.PATH, process.env.PATH);
  });

  it('resolveExecutablePath reads ATLAS_CLAUDE_PATH, trimmed', () => {
    process.env.ATLAS_CLAUDE_PATH = '  /custom/claude  ';
    const auth = new StandaloneAuth();
    assert.equal(auth.resolveExecutablePath(), '/custom/claude');
  });

  it('resolveExecutablePath is undefined when unset', () => {
    const auth = new StandaloneAuth();
    assert.equal(auth.resolveExecutablePath(), undefined);
  });

  it('resolveModel reads the per-provider env var', () => {
    process.env.ATLAS_MODEL = 'claude-opus-4-8';
    const auth = new StandaloneAuth();
    assert.equal(auth.resolveModel('anthropic'), 'claude-opus-4-8');
  });

  it('setApiKey / clearApiKey are explicitly unsupported, not silent no-ops', async () => {
    const auth = new StandaloneAuth();
    await assert.rejects(auth.setApiKey('anthropic', 'sk-x'), /in-app key entry/);
    await assert.rejects(auth.clearApiKey('anthropic'), /in-app key entry/);
  });
});
