/**
 * Per-run agent resolution: which engine powers this Detect/Chat/Apply?
 *
 * Resolution happens at the start of every AI job (not at panel creation), so
 * changing `atlas.provider` or adding a key takes effect immediately. The
 * decision matrix itself lives in `engineResolution.ts` (host-agnostic, no
 * `vscode` import — shared with the standalone studio server); this file is
 * just the thin VS Code-specific outer function that reads configuration and
 * constructs SDK clients.
 */

import * as vscode from 'vscode';

import { AiError } from './agent';
import { AuthProvider } from './AuthProvider';
import { ClaudeSdkAgent } from './ClaudeSdkAgent';
import {
  decideEngine,
  ENGINE_LABELS,
  findClaudeCli,
  type AgentResolution,
  type ResolveAgentOptions,
} from './engineResolution';
import { BuiltinLoopAgent } from './loop/BuiltinLoopAgent';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenAiProvider } from './providers/openai';

export {
  claudeCliAvailable,
  decideEngine,
  ENGINE_LABELS,
  findClaudeCli,
  type AgentResolution,
  type EngineId,
  type ResolveAgentOptions,
} from './engineResolution';

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
