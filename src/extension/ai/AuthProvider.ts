/**
 * Resolves how Atlas authenticates to Claude.
 *
 * Strategy, in order of preference:
 *   1. An Anthropic API key the user stored (kept in VS Code SecretStorage).
 *   2. The `ANTHROPIC_API_KEY` already present in the environment.
 *   3. The user's existing Claude Code login — the Agent SDK spawns the
 *      `claude` executable, which uses its own stored credentials when no key
 *      is supplied.
 *
 * This keeps the common case zero-config (already logged into Claude Code)
 * while still supporting an explicit key for headless/CI use.
 */

import * as vscode from 'vscode';

const SECRET_KEY = 'atlas.anthropicApiKey';

export class AuthProvider {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(): Promise<string | undefined> {
    const stored = await this.secrets.get(SECRET_KEY);
    return stored || process.env.ANTHROPIC_API_KEY || undefined;
  }

  async setApiKey(key: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, key.trim());
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }

  /**
   * Build the environment passed to the Agent SDK subprocess. When a key is
   * available it is injected; otherwise the inherited environment (and the
   * `claude` CLI's own login) is used.
   */
  async buildEnv(): Promise<Record<string, string | undefined>> {
    const key = await this.getApiKey();
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

  /** Preferred model id from settings, if the user pinned one. */
  resolveModel(): string | undefined {
    const configured = vscode.workspace.getConfiguration('atlas').get<string>('model');
    return configured && configured.trim().length > 0 ? configured.trim() : undefined;
  }
}
