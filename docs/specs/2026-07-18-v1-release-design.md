# Atlas v1 Release: Provider Abstraction, Multi-Client Reach, Marketplace Publish

**Date:** 2026-07-18
**Status:** Approved (design)

## Goal

Ship Atlas 0.2.0 publicly with three properties it doesn't have today:

1. **The native AI features (Detect, Chat, Apply → codegen) work without the `claude` CLI** — any user with an Anthropic, OpenAI, or Gemini API key gets every button, in VS Code or Cursor.
2. **Any MCP-capable agent can drive the map** — the register command supports Claude Code, Cursor, and other clients; a headless npm package serves users with no editor.
3. **The extension is installable from both the VS Code Marketplace and Open VSX** (Open VSX is what Cursor and other forks install from).

## Product positioning (context for all decisions)

Atlas is the **architecture control plane for agentic coding**: a live visual model
(`atlas.yaml`) that any agent reads and writes, with rules/drift-checking as the
retention wedge. It is deliberately agent-agnostic — we do not compete with
Claude Code/Cursor/Kiro shells; we plug into them. v1 monetization: none
(free extension, BYO API keys, zero COGS). Team features (hosted model sharing,
PR gating, drift reports) are the later paid layer.

## Non-goals for v1

- No hosted/billed API keys, no backend, no accounts.
- No standalone desktop app.
- No agent-CLI adapters (`cursor-agent -p`, `codex exec`, `gemini -p`): output
  formats are unstable, `cursor-agent -p` has open hang bugs, and none of them
  can honor Atlas's programmatic write-confinement gate. The MCP server is the
  supported path for "use your own agent."

---

## Phase A — Provider abstraction

### A1. `ArchitectureAgent` interface

Extract from the existing `ClaudeAgent` class (src/extension/ai/ClaudeAgent.ts)
— its public surface is already exactly right:

```ts
interface ArchitectureAgent {
  detect(cwd, onEvent, abort, previous?): Promise<ArchitectureModel>;
  chat(cwd, model, history, message, onToken, abort): Promise<ChatResponse>;
  generateCode(cwd, delta, model, instruction, onEvent, abort): Promise<CodegenResult>;
}
```

`AgentEvent`, `AgentEventHandler`, `AiError`/`AiErrorCode`, `CodegenResult` move
to a shared module. Callers (`aiCommands.ts`, `ArchitecturePanel`) depend only on
the interface; a factory picks the implementation per run (so a settings change
takes effect without reload).

### A2. Implementations

**`ClaudeSdkAgent`** — the current file, renamed, behavior unchanged. Premium
path: reuses Claude Code login, no key entry needed.

**`BuiltinLoopAgent`** — new. An agent loop owned by Atlas, parameterized by an
`LlmClient`:

```ts
interface LlmClient {
  // One model turn: full message history + tool schemas in,
  // streamed text deltas + parsed tool calls + stop reason out.
  turn(req: LlmTurnRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<LlmTurnResult>;
}
```

The loop: send prompt + tool schemas → execute returned tool calls in the
extension host → append results → repeat until stop. Per-job specifics:

- **detect** — tools: Read/Glob/Grep. Final answer constrained to
  `buildDetectionSchema()` via each provider's structured-output mechanism
  (Anthropic `output_config.format`; OpenAI `response_format: json_schema`;
  Gemini `responseSchema`). Same zero-node failure guard as today.
- **chat** — tools: Read/Glob/Grep; streams prose via `onToken`; trailing fenced
  proposal block parsed by the existing `parseChatReply`.
- **generateCode** — tools: Read/Glob/Grep/Write/Edit. **No shell tool exists in
  the loop at all.** Write/Edit route through the existing `codegenGuard`
  semantics (symlink-aware `resolveWithinRoot` confinement); touched files
  collected for revert, same as today. The security promise — no shell, writes
  confined to the workspace — is enforced by the host, identically for every
  provider.

Tool implementations (host-side): `Read` (bounded file read), `Glob`
(workspace file matching), `Grep` (regex search), `Write`/`Edit`
(guarded). Watchdog ceilings carry over: detect 5m, chat 5m, codegen 15m.

### A3. Providers

| Provider | SDK | Default model | Notes |
|---|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` (bundled — plain CJS, esbuild-friendly) | `claude-opus-4-8` | `thinking: {type: "adaptive"}`; streaming |
| `openai` | `openai` | configurable, sensible default at implementation time | tool calling + `json_schema` response format |
| `gemini` | `@google/genai` | configurable, sensible default at implementation time | function calling + `responseSchema` |

Provider errors normalize into the existing `AiError` codes
(`auth` / `cancelled` / `failed`) so the UI needs no changes.

### A4. Settings & auth

- `atlas.provider`: `auto` (default) | `claude-code` | `anthropic` | `openai` | `gemini`.
  - `auto`: `claude` CLI resolvable → `ClaudeSdkAgent`; else first provider with
    a stored key (anthropic → openai → gemini); else the existing
    "set up AI" guidance, updated to list all options.
- `atlas.model` keeps working for the Claude paths; per-provider model overrides
  (`atlas.openai.model`, `atlas.gemini.model`) added.
- `Atlas: Set API Key` (replaces "Set Anthropic API Key", old command kept as
  alias): provider picker → SecretStorage under a per-provider key.
  `Atlas: Clear API Key` likewise.

### A5. Testing

- Unit: `BuiltinLoopAgent` against a scripted mock `LlmClient` — multi-round
  tool loops, guard denial (out-of-workspace write, symlink escape), abort
  mid-round, watchdog expiry, malformed tool args, structured-output parse
  failures.
- Unit: each provider's request-building and error normalization (mock HTTP).
- Existing suite stays green; `ClaudeSdkAgent` path untouched.
- Manual smoke matrix before release: {claude-code, anthropic, openai, gemini} ×
  {detect, chat, apply} in VS Code + at least anthropic in Cursor.

---

## Phase B — Multi-client reach

### B1. Multi-client MCP registration

`Atlas: Register MCP Server` gains a multi-select client picker; writes/merges:

| Client | File | Shape |
|---|---|---|
| Claude Code | `.mcp.json` | current behavior |
| Cursor | `.cursor/mcp.json` | same `mcpServers` shape |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | same shape |
| Gemini CLI | `.gemini/settings.json` (`mcpServers` key) | same shape |
| Codex CLI | `~/.codex/config.toml` (`mcp_servers` table) | TOML |

Exact paths/shapes verified against current client docs at implementation time;
each writer merges rather than overwrites, and unknown existing content is
preserved. Docs/MCP.md updated with per-client sections.

### B2. Headless npm package

Publish `atlas-architecture-mcp` (final name checked for npm availability):
contains the built `mcp-server.mjs` + `atlas-check` + `atlas-diff` binaries.
`npx atlas-architecture-mcp` runs the server against `ATLAS_WORKSPACE` (or cwd);
`npx atlas-architecture-mcp check` runs rules for CI. Built from the same
sources (`src/mcp`, `src/cli`) by the existing esbuild pipeline; no extension
dependency.

---

## Phase C — Publish

1. **Publisher**: create Marketplace publisher (ID decided at signup, e.g.
   `afetiu`); update `package.json` `publisher`; create Open VSX namespace.
2. **Assets**: 128×128+ icon (`icon` field), `CHANGELOG.md`, README: demo GIF
   (detect → drag → chat → apply diff), absolute image URLs, install-from-
   marketplace quick start replacing the F5 flow, and a disclosure section: AI
   features send repository content to the configured provider (Anthropic/
   OpenAI/Google); nothing is sent without an explicit AI action.
3. **VSIX verification**: `vsce package`; check size; install from VSIX into
   clean VS Code *and* Cursor; verify the Agent SDK dynamic import from the
   installed extension dir, the built-in loop path, and the MCP server
   registration path. Revisit `.vscodeignore` now that `@anthropic-ai/sdk`,
   `openai`, `@google/genai` bundle into `dist/` (only the Agent SDK stays
   unbundled).
4. **Publish**: `vsce publish` + `ovsx publish` + `npm publish`, wired into a
   GitHub Actions release workflow triggered by version tags; tokens in repo
   secrets.
5. **Version**: 0.2.0.

---

## Risks & mitigations

- **Built-in loop quality vs Agent SDK** — the SDK's loop is battle-tested; ours
  is new. Mitigation: keep jobs simple (three fixed tool sets), test the loop
  hard, keep the SDK as default when available, label provider paths clearly in
  error messages so reports are attributable.
- **Detection quality varies by provider/model** — accept for v1; the model
  override settings are the escape hatch. Retention risk lives here; post-v1
  work should prioritize detection quality.
- **MCP config formats drift** — verified at implementation time; each writer is
  ~20 lines and independently testable.
- **VSIX bloat** — three bundled SDKs; measured in C3, tree-shaken by esbuild.

## Rollout order

A → B → C. Each phase lands as a reviewed PR (or small series) on `main`;
nothing publishes until C is verified.
