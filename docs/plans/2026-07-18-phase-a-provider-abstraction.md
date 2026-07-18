# Phase A — Provider Abstraction: Implementation Plan

**Date:** 2026-07-18 · **Status:** Approved · Implements Phase A of
[docs/specs/2026-07-18-v1-release-design.md](../specs/2026-07-18-v1-release-design.md)

## Goal

Make Detect, Chat, and Apply → codegen work for any user — Claude Code login,
or a BYO API key from Anthropic, OpenAI, or Gemini — in VS Code and Cursor,
with the same security guarantees the Claude SDK path has today.

## Architecture

One `ArchitectureAgent` interface, two implementations:

```
Webview panel ── aiCommands.ts ── resolveAgent()  [atlas.provider]
                                     ├─ claude CLI found → ClaudeSdkAgent (existing, renamed)
                                     └─ stored API key  → BuiltinLoopAgent
                                                            ├─ host tools: Read/Glob/Grep + guarded Write/Edit (no shell)
                                                            └─ LlmClient → anthropic (claude-opus-4-8) | openai | gemini
```

## Contracts

```ts
// src/extension/ai/agent.ts — ClaudeAgent's existing public surface, extracted
export interface ArchitectureAgent {
  detect(cwd, onEvent, abort, previous?): Promise<ArchitectureModel>;
  chat(cwd, model, history, message, onToken, abort): Promise<ChatResponse>;
  generateCode(cwd, delta, model, instruction, onEvent, abort): Promise<CodegenResult>;
}

// src/extension/ai/loop/types.ts — one model turn; the loop owns everything else
export interface LlmClient {
  turn(req: LlmTurnRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<LlmTurnResult>;
}
```

## Tasks

| # | Task | Touches | Verified by |
|---|---|---|---|
| A1 | Extract agent contract (`agent.ts`); rename ClaudeAgent → ClaudeSdkAgent; callers typed against interface | agent.ts, ClaudeSdkAgent.ts, aiCommands.ts | existing suite green, typecheck |
| A2 | `atlas.provider` setting; per-provider SecretStorage keys; Set/Clear API Key provider picker (old commands aliased); per-provider model settings | package.json, AuthProvider.ts, aiCommands.ts | unit: key storage round-trip |
| A3 | Host-side tools: bounded Read, Glob, Grep; Write/Edit through symlink-aware `resolveWithinRoot` guard; JSON schemas. No shell tool exists | tools/*.ts | unit: guard denials, symlink escape, read bounds |
| A4 | `LlmClient` + `BuiltinLoopAgent`: turn → execute tools → append → repeat; watchdogs (5m/5m/15m), abort, touched files, AiError normalization | loop/types.ts, loop/BuiltinLoopAgent.ts | unit: scripted mock client — multi-round, abort, watchdog, malformed args |
| A5 | Anthropic provider: `@anthropic-ai/sdk`, default `claude-opus-4-8`, adaptive thinking, streaming; detect via `output_config.format` json_schema | providers/anthropic.ts | unit: request building, error mapping |
| A6 | OpenAI provider: tool calling + json_schema response format, streaming; default model chosen at implementation, setting-overridable | providers/openai.ts | unit: same shape as A5 |
| A7 | Gemini provider: `@google/genai`, function declarations + responseSchema, streaming | providers/gemini.ts | unit: same shape as A5 |
| A8 | Factory + auto-selection: explicit setting wins; auto = CLI → SDK, else first key (anthropic → openai → gemini), else setup guidance; provider surfaced in panel status | agentFactory.ts, ArchitecturePanel.ts | unit: resolution matrix |
| A9 | Bundling + docs: esbuild bundles the three provider SDKs into dist (Agent SDK stays dynamic); .vscodeignore comments; README auth + ARCHITECTURE.md updates | esbuild.js, README.md, docs/ARCHITECTURE.md | vsce package builds; size checked |
| A10 | Smoke matrix: {claude-code, anthropic, openai, gemini} × {detect, chat, apply} in VS Code; anthropic × all jobs in Cursor from VSIX | manual | checklist in PR description |

Order: A1–A2 unblock everything; A3–A4 are the core; A5–A7 parallel-friendly;
A8–A10 integrate. Each task lands with typecheck + lint + tests green.

## Security invariants (every provider)

- **No shell** — the built-in loop defines no Bash-equivalent tool at all.
- **Writes confined to the workspace** — Write/Edit resolve through the
  symlink-aware `resolveWithinRoot` check in the extension host.
- **Everything revertable** — touched files collected identically to the SDK path.
- **Keys in SecretStorage only** — never settings.json, never the repo, never logs.

## Risks

- Loop quality vs the battle-tested Agent SDK → small fixed tool surface, hard
  unit tests, SDK stays the auto-default, provider named in errors.
- Detection quality varies by provider/model → accepted for v1; override settings.
- Provider API drift → one file per provider; request building unit-tested.
- VSIX size from three bundled SDKs → measured at A9.

## Definition of done

- typecheck, lint, test green including new loop/tool/provider suites.
- Smoke matrix passes; Cursor VSIX install verified.
- A user with only an OpenAI key can open a repo in Cursor, run Detect, chat a
  change, and apply it — reviewing the diff — without any Claude tooling installed.
