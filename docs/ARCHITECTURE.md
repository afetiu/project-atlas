# Architecture

How Atlas is structured, the principles behind that structure, and the seams
designed for future expansion.

## Guiding principles

Atlas optimizes for **maintainability over speed of delivery**:

- **One source of truth.** The `ArchitectureModel` is the only authoritative
  representation of the graph. The canvas, the inspector, the YAML file, the AI,
  and the MCP server are all projections of it.
- **Clean layering with a shared core.** A framework-agnostic domain layer sits
  in the middle. The extension host, the webview, and the MCP server all depend
  on it; it depends on none of them.
- **Single-responsibility modules.** No giant files. Serialize, validate, diff,
  lay out, render a node, run an agent — each is its own module.
- **Open for extension.** Node types, protocols, message kinds, and AI contracts
  live in registries / discriminated unions, so growth is additive.

## The layers

```
src/
├── shared/      ← framework-agnostic domain core (no vscode, no React, no SDK)
├── extension/   ← VS Code extension host (Node) — UI panel + AI orchestration
├── webview/     ← the canvas, a standalone React app (browser)
└── mcp/         ← standalone MCP server exposing atlas.yaml to Claude Code
```

The dependency rule is strict and one-directional — everything points inward at
`shared/`:

```
extension ─┐
webview ───┼─►  shared
mcp ───────┘
```

`shared/` never imports from the others, which is what keeps the model portable:
the same core powers the extension, the React app, and a separate Node process.

### `shared/` — the domain core

| Module | Responsibility |
| --- | --- |
| `model/types.ts` | `ArchitectureModel`, nodes, edges, bounded-context `groups`, and the node→code `mapping`. |
| `model/nodeTypes.ts`, `model/protocols.ts` | Registries of node types and protocols. |
| `model/diff.ts` | Semantic delta between two models — the basis for code generation. |
| `model/layout.ts` | Deterministic layered auto-layout for AI-detected graphs. |
| `model/summary.ts` | Human-readable description of a model. |
| `serialization/yaml.ts` | The only place that knows the on-disk YAML shape. |
| `serialization/validation.ts` | Structural invariants (unique ids, no broken edges…). |
| `ai/detection.ts`, `ai/chat.ts` | JSON-Schema contracts + normalizers for the AI jobs. |
| `messaging/protocol.ts` | The strongly-typed host ⇄ webview message contract. |

### `extension/` — the VS Code host

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Activation. Thin: registers commands only. |
| `commands/*` | `Open Architecture`, `Detect`, API-key management, `Register MCP Server`. |
| `panel/ArchitecturePanel.ts` | Owns the webview and orchestrates detect / chat / apply. |
| `panel/webviewHtml.ts` | Locked-down (CSP + nonce) HTML shell. |
| `workspace/AtlasFileService.ts` | Reads/writes `atlas.yaml`, watches external edits, suppresses write-echo. |
| `workspace/BaselineStore.ts` | The code-synced model; its diff vs the live model = pending changes. |
| `workspace/git.ts` | Captures the working-tree diff after code generation. |
| `ai/ClaudeAgent.ts` | Wraps the Agent SDK `query()` loop with detect/chat/generate methods. |
| `ai/AuthProvider.ts` | Resolves a stored API key or falls back to the Claude Code login. |
| `ai/prompts.ts` | Prompt builders for the three jobs. |

### `webview/` — the React canvas

| Module | Responsibility |
| --- | --- |
| `model/useArchitectureModel.ts` | Graph state, mutators, debounced auto-save, host reconciliation. |
| `model/useAiSession.ts` | Chat, detection, proposals, progress, pending changes, errors. |
| `adapters/reactFlowAdapter.ts` | The single seam between the domain model and React Flow. |
| `components/*` | Canvas, custom node, palette, inspector, assistant chat, toolbar, diff overlay. |

### `mcp/` — the MCP server

| Module | Responsibility |
| --- | --- |
| `server.ts` | Registers MCP tools (get/describe/add/update/remove/connect/disconnect). |
| `atlasStore.ts` | fs-backed read/mutate/validate/write over `atlas.yaml`, reusing the core. |

## Data flow & synchronization

`atlas.yaml` is the hub; everything synchronizes through it.

**Canvas edit → file:**

```
user edit → mutator (useArchitectureModel) → debounce
          → model:changed → ArchitecturePanel → validate → AtlasFileService.write()
```

**External / MCP edit → canvas:**

```
edit on disk → FileSystemWatcher → AtlasFileService (echo check)
            → onDidChangeExternally → read() → model:loaded → webview
```

**Detect:**

```
Detect → ai:detect → ClaudeAgent.detect() [Agent SDK: Read/Glob/Grep, structured JSON]
       → detectedToModel() (normalize + layout) → write atlas.yaml + set baseline
       → model:loaded → canvas
```

**Chat:**

```
chat:send → ClaudeAgent.chat() [structured: reply + optional full target graph]
         → chat:reply (+ proposal) → Assistant panel → user clicks Apply
```

**Apply → code → verify:**

```
apply:request(target) → write atlas.yaml + model:loaded
                      → delta = diff(baseline, target)
                      → ClaudeAgent.generateCode() [Agent SDK: Read/Edit/Write only,
                          NO shell, writes confined to the workspace via canUseTool]
                      → git diff (scoped to touched files)
                      → verifyCodegen() [mapped paths exist + optional verify command]
                      → advance baseline ONLY if verified → apply:done → DiffOverlay
```

Code generation is sandboxed: shell is disabled and a `canUseTool` gate confines
writes to the workspace, so every effect is inside the repo and revertable. The
baseline advances only when the generated code is verified to realize the
change; otherwise it stays pending and the report says what's missing — this is
what keeps "the model is the source of truth" honest.

Two mechanisms prevent feedback loops: `AtlasFileService` remembers the exact
text it last wrote and ignores its own watcher events, and the webview applies
`model:loaded` *without* re-saving. Invalid models never reach disk —
`ArchitecturePanel` validates before writing and before any apply.

### The baseline

The **baseline** is the architecture the code currently reflects. Pending
changes are precisely `diff(baseline, liveModel)` (layout-only moves excluded).
Detection and a successful apply advance the baseline; opening an existing map
assumes the code already matches it. This is what makes "Apply N changes"
meaningful and keeps code generation scoped to real architectural deltas.

## AI integration choices

Researched against the current docs:

- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) powers Atlas's own AI. It is
  ESM-only and uses `import.meta.url`, so it is **not bundled** — it is marked
  external and loaded via dynamic `import()`. It spawns the `claude` executable,
  which means it transparently reuses the user's Claude Code login when no API
  key is set.
- **MCP server** exposes the map to the user's Claude Code. Bundled separately as
  ESM (`dist/mcp-server.mjs`) with a `require()` shim for its CJS dependencies.
- **Not used:** driving the Claude Code extension directly (no public API) and
  VS Code's `vscode.lm` (does not surface Claude).

## Extension points

| Future feature | Where it plugs in |
| --- | --- |
| New node type / protocol | One entry in `model/nodeTypes.ts` / `model/protocols.ts` — UI, validation, AI schemas, and MCP all derive from these. |
| Continuous code↔model sync | A watcher service feeding `detect`/`diff` on file changes. |
| New host ⇄ webview messages | Add a variant to the unions in `messaging/protocol.ts`; both ends get compile-time coverage. |
| Richer validation / policy | Extend `serialization/validation.ts`; it already runs on every persist and apply. |
| New MCP capabilities | Register another tool in `mcp/server.ts`. |
| Swapping the canvas library | Confined to `adapters/reactFlowAdapter.ts` and the canvas component. |
| Schema migrations | `model/types.ts` carries a `version`; `serialization/yaml.ts` is the choke point. |

The throughline: **the model is decoupled from everything**, so new capabilities
attach to the model rather than threading through the UI.
