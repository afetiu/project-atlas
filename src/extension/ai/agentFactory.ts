/**
 * Per-run agent resolution: which engine powers this Detect/Chat/Apply?
 *
 * Resolution happens at the start of every AI job (not at panel creation), so
 * changing `atlas.provider` or adding a key takes effect immediately. The
 * decision matrix is pure and unit-tested; only the thin outer function reads
 * VS Code configuration and constructs SDK clients.
 */

import { existsSync } from 'fs';
import { delimiter, join } from 'path';

import * as vscode from 'vscode';

import { AiError, type ArchitectureAgent } from './agent';
import { AuthProvider, type AiProviderId } from './AuthProvider';
import { ClaudeSdkAgent } from './ClaudeSdkAgent';
import { BuiltinLoopAgent } from './loop/BuiltinLoopAgent';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenAiProvider } from './providers/openai';

export type EngineId = 'claude-code' | AiProviderId;

export const ENGINE_LABELS: Record<EngineId, string> = {
  'claude-code': 'Claude Code',
  anthropic: 'Anthropic API',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

export interface AgentResolution {
  agent: ArchitectureAgent;
  engine: EngineId;
  /** Short human-readable engine name for status lines and logs. */
  label: string;
}

const SETUP_GUIDANCE =
  'Atlas has no AI engine configured. Either install and log in to the claude CLI (Claude Code), ' +
  'or run "Atlas: Set AI API Key" to store an Anthropic, OpenAI, or Gemini key.';

/**
 * Locate the `claude` executable — explicitly configured or on PATH — and
 * return its concrete path. The path is handed to the Agent SDK, which does
 * not search PATH itself (its bundled binary is deliberately not shipped in
 * the VSIX).
 */
export function findClaudeCli(
  explicitPath: string | undefined,
  envPath: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (explicitPath) {
    return existsSync(explicitPath) ? explicitPath : undefined;
  }
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.ps1'] : ['claude'];
  for (const dir of (envPath ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Boolean convenience over {@link findClaudeCli}. */
export function claudeCliAvailable(
  explicitPath: string | undefined,
  envPath: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return findClaudeCli(explicitPath, envPath, platform) !== undefined;
}

/**
 * The pure decision matrix. Throws AiError('auth', …) with actionable guidance
 * when the requested engine (or any engine, for auto) is unusable.
 */
export async function decideEngine(input: {
  setting: string;
  cliAvailable: boolean;
  hasKey: (provider: AiProviderId) => Promise<boolean>;
  firstConfigured: () => Promise<AiProviderId | undefined>;
}): Promise<EngineId> {
  const { setting, cliAvailable } = input;

  if (setting === 'claude-code') {
    if (!cliAvailable) {
      throw new AiError(
        'auth',
        'atlas.provider is "claude-code" but the claude CLI was not found. Install Claude Code or set atlas.claudeExecutablePath.',
      );
    }
    return 'claude-code';
  }

  if (setting === 'anthropic' || setting === 'openai' || setting === 'gemini') {
    if (!(await input.hasKey(setting))) {
      throw new AiError(
        'auth',
        `atlas.provider is "${setting}" but no ${ENGINE_LABELS[setting]} key is stored. Run "Atlas: Set AI API Key".`,
      );
    }
    return setting;
  }

  // "auto" (and anything unrecognized): prefer the Claude Code login, then the
  // first provider with a key, in anthropic → openai → gemini order.
  if (cliAvailable) {
    return 'claude-code';
  }
  const fallback = await input.firstConfigured();
  if (fallback) {
    return fallback;
  }
  throw new AiError('auth', SETUP_GUIDANCE);
}

/** Resolve the engine and construct the agent for one AI job. */
export async function resolveAgent(auth: AuthProvider): Promise<AgentResolution> {
  const setting = vscode.workspace.getConfiguration('atlas').get<string>('provider') ?? 'auto';
  const cliPath = findClaudeCli(auth.resolveExecutablePath());
  const engine = await decideEngine({
    setting,
    cliAvailable: cliPath !== undefined,
    hasKey: async (provider) => (await auth.getApiKey(provider)) !== undefined,
    firstConfigured: () => auth.firstConfiguredProvider(),
  });

  if (engine === 'claude-code') {
    return { agent: new ClaudeSdkAgent(auth, cliPath), engine, label: ENGINE_LABELS[engine] };
  }

  const key = await auth.getApiKey(engine);
  if (!key) {
    throw new AiError('auth', `No ${ENGINE_LABELS[engine]} key is stored. Run "Atlas: Set AI API Key".`);
  }
  const model = auth.resolveModel(engine);
  const client =
    engine === 'anthropic'
      ? new AnthropicProvider(key, model ?? undefined)
      : engine === 'openai'
        ? new OpenAiProvider(key, model ?? undefined)
        : new GeminiProvider(key, model ?? undefined);
  return { agent: new BuiltinLoopAgent(client), engine, label: ENGINE_LABELS[engine] };
}
