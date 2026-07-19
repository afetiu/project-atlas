/**
 * Per-run agent resolution: which engine powers this Detect/Chat/Apply?
 *
 * Resolution happens at the start of every AI job (not at panel creation), so
 * changing `atlas.provider` or adding a key takes effect immediately. The
 * decision matrix is pure and unit-tested; only the thin outer function reads
 * VS Code configuration and constructs SDK clients.
 */

import { existsSync } from 'fs';
import { delimiter, dirname, join } from 'path';

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
    return existsSync(explicitPath) ? spawnablePath(explicitPath, platform) : undefined;
  }
  const dirs = (envPath ?? '').split(delimiter).filter(Boolean);
  // Two passes: a real executable anywhere on PATH beats an npm shim earlier
  // on it — native installs are the healthy, self-updating ones.
  if (platform === 'win32') {
    for (const dir of dirs) {
      const exe = join(dir, 'claude.exe');
      if (existsSync(exe)) {
        return exe;
      }
    }
    for (const dir of dirs) {
      for (const name of ['claude.cmd', 'claude.ps1']) {
        const candidate = join(dir, name);
        if (existsSync(candidate)) {
          const spawnable = spawnablePath(candidate, platform);
          if (spawnable) {
            return spawnable;
          }
          // Unresolvable shim — keep probing later PATH entries.
        }
      }
    }
    return undefined;
  }
  for (const dir of dirs) {
    const candidate = join(dir, 'claude');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Node refuses to spawn `.cmd`/`.ps1` files directly (EINVAL, CVE-2024-27980
 * hardening), so an npm-installed `claude` shim cannot be handed to the Agent
 * SDK as-is. Resolve through the shim to the real JS entry point — the SDK
 * runs `.js` paths via Node itself. Real executables pass through unchanged.
 */
function spawnablePath(candidate: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32' || !/\.(cmd|ps1|bat)$/i.test(candidate)) {
    return candidate;
  }
  // npm shim layout: <dir>/claude.cmd wraps <dir>/node_modules/@anthropic-ai/claude-code/cli.js
  const cliJs = join(dirname(candidate), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  return existsSync(cliJs) ? cliJs : undefined;
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

export interface ResolveAgentOptions {
  /**
   * Pretend the claude CLI does not exist — used to fall back to a direct
   * provider after the Claude Code engine failed to launch (broken/outdated
   * CLI installs happen; users should not pay for them).
   */
  skipClaudeCode?: boolean;
}

/** Resolve the engine and construct the agent for one AI job. */
export async function resolveAgent(
  auth: AuthProvider,
  options: ResolveAgentOptions = {},
): Promise<AgentResolution> {
  const setting = vscode.workspace.getConfiguration('atlas').get<string>('provider') ?? 'auto';
  const cliPath = options.skipClaudeCode ? undefined : findClaudeCli(auth.resolveExecutablePath());
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
