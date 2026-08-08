/**
 * Standalone counterpart to `extension/ai/AuthProvider.ts`. There is no VS
 * Code SecretStorage and no native input box outside an editor, so v1 is
 * env-var only: the same conventional variables `AuthProvider` already falls
 * back to, plus the existing `claude` CLI login. Setting a key through the UI
 * ("Atlas: Set AI API Key") isn't wired up standalone yet — `setApiKey` /
 * `clearApiKey` say so explicitly rather than silently no-op.
 */

import type { AiAuth, AiProviderId } from '../extension/ai/AuthProvider';

const ENV_KEYS: Record<AiProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

const MODEL_ENV_KEYS: Record<AiProviderId, string> = {
  anthropic: 'ATLAS_MODEL',
  openai: 'ATLAS_OPENAI_MODEL',
  gemini: 'ATLAS_GEMINI_MODEL',
};

const NOT_SUPPORTED =
  'atlas-studio has no in-app key entry yet — set the provider\'s environment variable ' +
  '(ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY) and restart atlas-studio.';

export class StandaloneAuth implements AiAuth {
  async getApiKey(provider: AiProviderId = 'anthropic'): Promise<string | undefined> {
    for (const envKey of ENV_KEYS[provider]) {
      if (process.env[envKey]) {
        return process.env[envKey];
      }
    }
    return undefined;
  }

  async setApiKey(_provider: AiProviderId, _key: string): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }

  async clearApiKey(_provider: AiProviderId): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }

  async firstConfiguredProvider(): Promise<AiProviderId | undefined> {
    for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
      if (await this.getApiKey(provider)) {
        return provider;
      }
    }
    return undefined;
  }

  async buildEnv(): Promise<Record<string, string | undefined>> {
    const key = await this.getApiKey('anthropic');
    const env: Record<string, string | undefined> = { ...process.env };
    if (key) {
      env.ANTHROPIC_API_KEY = key;
    }
    return env;
  }

  /** `ATLAS_CLAUDE_PATH` mirrors the extension's `atlas.claudeExecutablePath` setting. */
  resolveExecutablePath(): string | undefined {
    const configured = process.env.ATLAS_CLAUDE_PATH?.trim();
    return configured ? configured : undefined;
  }

  resolveModel(provider: AiProviderId = 'anthropic'): string | undefined {
    const configured = process.env[MODEL_ENV_KEYS[provider]]?.trim();
    return configured ? configured : undefined;
  }
}
