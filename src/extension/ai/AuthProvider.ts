/**
 * Resolves how Atlas authenticates to its AI providers.
 *
 * Per provider, in order of preference:
 *   1. A key the user stored via `Atlas: Set AI API Key` (VS Code SecretStorage).
 *   2. The provider's conventional environment variable.
 *   3. Anthropic only: the user's existing Claude Code login — the Agent SDK
 *      spawns the `claude` executable, which uses its own stored credentials
 *      when no key is supplied.
 *
 * This keeps the common case zero-config (already logged into Claude Code)
 * while letting Cursor users and CLI-less setups bring their own key.
 */

import * as vscode from 'vscode';

export type AiProviderId = 'anthropic' | 'openai' | 'gemini';

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
};

/**
 * The Anthropic entry predates multi-provider support — existing users already
 * have a secret stored under it, so its name must not change.
 */
const SECRET_KEYS: Record<AiProviderId, string> = {
  anthropic: 'atlas.anthropicApiKey',
  openai: 'atlas.openaiApiKey',
  gemini: 'atlas.geminiApiKey',
};

const ENV_KEYS: Record<AiProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

export class AuthProvider {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(provider: AiProviderId = 'anthropic'): Promise<string | undefined> {
    const stored = await this.secrets.get(SECRET_KEYS[provider]);
    if (stored) {
      return stored;
    }
    for (const envKey of ENV_KEYS[provider]) {
      if (process.env[envKey]) {
        return process.env[envKey];
      }
    }
    return undefined;
  }

  async setApiKey(provider: AiProviderId, key: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS[provider], key.trim());
  }

  async clearApiKey(provider: AiProviderId): Promise<void> {
    await this.secrets.delete(SECRET_KEYS[provider]);
  }

  /** The first provider (in priority order) with a usable key, if any. */
  async firstConfiguredProvider(): Promise<AiProviderId | undefined> {
    for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
      if (await this.getApiKey(provider)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Build the environment passed to the Agent SDK subprocess. When a key is
   * available it is injected; otherwise the inherited environment (and the
   * `claude` CLI's own login) is used.
   */
  async buildEnv(): Promise<Record<string, string | undefined>> {
    const key = await this.getApiKey('anthropic');
    const env: Record<string, string | undefined> = { ...process.env };
    if (key) {
      env.ANTHROPIC_API_KEY = key;
    }
    return env;
  }

  /** Optional explicit path to the `claude` executable from settings. */
  resolveExecutablePath(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration('atlas')
      .get<string>('claudeExecutablePath');
    return configured && configured.trim().length > 0 ? configured.trim() : undefined;
  }

  /**
   * Preferred model id from settings, if the user pinned one. `atlas.model`
   * covers both Claude paths (SDK and direct API); OpenAI and Gemini have
   * their own settings because model ids are not interchangeable.
   */
  resolveModel(provider: AiProviderId = 'anthropic'): string | undefined {
    const section = vscode.workspace.getConfiguration('atlas');
    const configured =
      provider === 'anthropic'
        ? section.get<string>('model')
        : section.get<string>(`${provider}.model`);
    return configured && configured.trim().length > 0 ? configured.trim() : undefined;
  }
}
