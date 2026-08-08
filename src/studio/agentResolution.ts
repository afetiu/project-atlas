/**
 * Standalone counterpart to `extension/ai/agentFactory.ts`'s `resolveAgent`.
 * The decision matrix itself (`decideEngine`) and CLI discovery
 * (`findClaudeCli`) are already host-agnostic and are reused as-is; only the
 * "where does the provider setting come from" edge differs — `atlas.provider`
 * (VS Code config) becomes `ATLAS_PROVIDER` (env var).
 */

import { AiError } from '../extension/ai/agent';
import type { AiAuth } from '../extension/ai/AuthProvider';
import {
  decideEngine,
  findClaudeCli,
  ENGINE_LABELS,
  type AgentResolution,
  type ResolveAgentOptions,
} from '../extension/ai/engineResolution';
import { ClaudeSdkAgent } from '../extension/ai/ClaudeSdkAgent';
import { BuiltinLoopAgent } from '../extension/ai/loop/BuiltinLoopAgent';
import { AnthropicProvider } from '../extension/ai/providers/anthropic';
import { GeminiProvider } from '../extension/ai/providers/gemini';
import { OpenAiProvider } from '../extension/ai/providers/openai';

export async function resolveAgentStandalone(
  auth: AiAuth,
  options: ResolveAgentOptions = {},
): Promise<AgentResolution> {
  const setting = process.env.ATLAS_PROVIDER?.trim() || 'auto';
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
    throw new AiError('auth', `No ${ENGINE_LABELS[engine]} key is stored. Set its environment variable.`);
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
