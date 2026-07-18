import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AuthProvider, type AiProviderId } from '../src/extension/ai/AuthProvider';
import { __setConfig } from './helpers/vscodeStub';

/** In-memory stand-in for vscode.SecretStorage. */
function memorySecrets() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    store: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    keys: () => [...store.keys()],
  };
}

const ENV_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const savedEnv: Record<string, string | undefined> = {};

describe('AuthProvider', () => {
  beforeEach(() => {
    for (const name of ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    __setConfig({});
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    }
  });

  it('stores, returns, and clears a key per provider', async () => {
    const secrets = memorySecrets();
    const auth = new AuthProvider(secrets as never);

    await auth.setApiKey('openai', '  sk-test-123  ');
    assert.equal(await auth.getApiKey('openai'), 'sk-test-123');
    // Other providers are unaffected.
    assert.equal(await auth.getApiKey('anthropic'), undefined);
    assert.equal(await auth.getApiKey('gemini'), undefined);

    await auth.clearApiKey('openai');
    assert.equal(await auth.getApiKey('openai'), undefined);
  });

  it('keeps the legacy secret name for anthropic', async () => {
    // Users who stored a key before multi-provider support must not lose it.
    const secrets = memorySecrets();
    await secrets.store('atlas.anthropicApiKey', 'sk-ant-legacy');
    const auth = new AuthProvider(secrets as never);
    assert.equal(await auth.getApiKey('anthropic'), 'sk-ant-legacy');
  });

  it('prefers the stored key over the environment', async () => {
    process.env.OPENAI_API_KEY = 'sk-from-env';
    const secrets = memorySecrets();
    const auth = new AuthProvider(secrets as never);
    assert.equal(await auth.getApiKey('openai'), 'sk-from-env');

    await auth.setApiKey('openai', 'sk-stored');
    assert.equal(await auth.getApiKey('openai'), 'sk-stored');
  });

  it('falls back to GOOGLE_API_KEY for gemini', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-google';
    const auth = new AuthProvider(memorySecrets() as never);
    assert.equal(await auth.getApiKey('gemini'), 'AIza-google');
    // GEMINI_API_KEY wins over GOOGLE_API_KEY when both are set.
    process.env.GEMINI_API_KEY = 'AIza-gemini';
    assert.equal(await auth.getApiKey('gemini'), 'AIza-gemini');
  });

  it('firstConfiguredProvider follows anthropic → openai → gemini priority', async () => {
    const secrets = memorySecrets();
    const auth = new AuthProvider(secrets as never);
    assert.equal(await auth.firstConfiguredProvider(), undefined);

    await auth.setApiKey('gemini', 'AIza-1');
    assert.equal(await auth.firstConfiguredProvider(), 'gemini');
    await auth.setApiKey('openai', 'sk-1');
    assert.equal(await auth.firstConfiguredProvider(), 'openai');
    await auth.setApiKey('anthropic', 'sk-ant-1');
    assert.equal(await auth.firstConfiguredProvider(), 'anthropic');
  });

  it('resolves the model from the provider-specific setting', () => {
    __setConfig({
      'atlas.model': 'claude-opus-4-8',
      'atlas.openai.model': 'gpt-test',
      'atlas.gemini.model': '',
    });
    const auth = new AuthProvider(memorySecrets() as never);
    assert.equal(auth.resolveModel('anthropic'), 'claude-opus-4-8');
    assert.equal(auth.resolveModel('openai'), 'gpt-test');
    // Empty string means "use the provider default".
    assert.equal(auth.resolveModel('gemini'), undefined);
    const providers: AiProviderId[] = ['anthropic', 'openai', 'gemini'];
    assert.equal(providers.length, 3);
  });
});
