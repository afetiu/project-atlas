# Architecture

This document explains how Atlas is structured, the principles behind that
structure, and the seams designed for future expansion.

## Guiding principles

Atlas optimizes for **maintainability over speed of delivery**. Concretely:

- **One source of truth.** The `ArchitectureModel` is the only authoritative
  representation of the graph. Everything else — the canvas, the inspector, the
  YAML file — is a projection of it.
- **Clean layering with a shared core.** A framework-agnostic domain layer sits
  in the middle. The extension host and the webview both depend on it; it
  depends on neither.
- **Single-responsibility modules.** No giant files. Each module does one thing:
  serialize, validate, manage a panel, hold state, render a node.
- **Open for extension.** Node types, protocols, and message kinds live in
  registries and discriminated unions, so adding to them is additive.

## The three layers

```
src/
├── shared/      ← framework-agnostic domain core (no vscode, no React)
├── extension/   ← VS Code extension host (Node)
└── webview/     ← the canvas, a standalone React app (browser)
```

The dependency rule is strict and one-directional:

```
extension ─┐
           ├─►  shared
webview ───┘
```

`shared/` never imports from `extension/` or `webview/`. This is what keeps the
domain model portable — a future CLI, language server, or AI agent could reuse
`shared/` untouched.

### `shared/` — the domain core

| Module | Responsibility |
| --- | --- |
| `model/types.ts` | The `ArchitectureModel`, `ArchitectureNode`, `ArchitectureEdge` types and the schema version. |
| `model/nodeTypes.ts` | Registry of node types (id, label, accent, icon). |
| `model/protocols.ts` | Registry of connection protocols. |
| `serialization/yaml.ts` | The **only** place that knows the on-disk YAML shape. Serialize / deserialize + normalization. |
| `serialization/validation.ts` | Structural invariants: unique ids, no broken edges, known types/protocols. |
| `messaging/protocol.ts` | The strongly-typed message contract between host and webview. |

Nothing here imports `vscode` or `react`. It is pure TypeScript and could run
anywhere.

### `extension/` — the VS Code host

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Activation. Thin: registers commands and nothing else. |
| `commands/openArchitecture.ts` | The `Atlas: Open Architecture` command. |
| `panel/ArchitecturePanel.ts` | Owns the webview panel lifecycle and bridges messages ↔ the file service. |
| `panel/webviewHtml.ts` | Builds the locked-down (CSP + nonce) HTML shell. |
| `workspace/AtlasFileService.ts` | Reads/writes `atlas.yaml`, watches for external edits, suppresses its own write-echo. |

### `webview/` — the React canvas

| Module | Responsibility |
| --- | --- |
| `index.tsx` | Mounts the React app, pulls in styles. |
| `vscodeApi.ts` | Typed wrapper over `acquireVsCodeApi` — the only place that touches the host bridge. |
| `model/useArchitectureModel.ts` | The webview's source of truth: model state, mutators, debounced auto-save, host reconciliation. |
| `model/ids.ts` | Collision-free id generation. |
| `adapters/reactFlowAdapter.ts` | The single seam where the domain model meets React Flow. |
| `components/*` | Presentational components: canvas, custom node, palette, inspector, banner. |

## Data flow & synchronization

The canvas and `atlas.yaml` are kept in sync through a deliberately simple,
loop-free protocol.

**Editing on the canvas → file:**

```
user edit → mutator (useArchitectureModel) → debounce
          → postMessage('model:changed') → ArchitecturePanel
          → validateModel() → AtlasFileService.write()
```

**Editing the file → canvas:**

```
external save → FileSystemWatcher → AtlasFileService (echo check)
             → onDidChangeExternally → ArchitecturePanel.read()
             → postMessage('model:loaded') → useArchitectureModel (replace, no re-save)
```

Two mechanisms prevent an infinite feedback loop:

1. **Write-echo suppression.** `AtlasFileService` remembers the exact text it
   last wrote. When the watcher fires, it compares on-disk content against that
   text and ignores its own writes.
2. **Load-without-persist.** When the webview receives `model:loaded`, it
   replaces state *without* scheduling a save — that data already came from disk.

Invalid models never reach disk: `ArchitecturePanel` runs `validateModel`
before writing and reports problems back to the webview as a `model:error`
banner instead of persisting a broken graph.

## Build pipeline

A single [`esbuild.js`](../esbuild.js) produces two bundles from one source tree:

- **Extension** → `dist/extension.js` (Node/CommonJS, `vscode` external).
- **Webview** → `dist/webview.js` + `dist/webview.css` (browser/IIFE, everything
  bundled, including React Flow's stylesheet).

This dual-target build is what makes the `shared/` layer genuinely shared:
the same modules compile into both worlds.

## Extension points

Atlas's roadmap items map onto concrete, already-present seams:

| Future feature | Where it plugs in |
| --- | --- |
| New node type / protocol | Add one entry to `model/nodeTypes.ts` / `model/protocols.ts`. The palette, inspector, icons, and validation all read from these registries. |
| AI code generation | A new command in `extension/commands/` consuming the `ArchitectureModel` from `AtlasFileService`. The model is already serializable and decoupled from the UI. |
| New host ↔ webview messages | Add a variant to the discriminated unions in `messaging/protocol.ts`; both ends get compile-time coverage. |
| Richer validation rules | Extend `serialization/validation.ts`; it already runs on every persist. |
| Swapping the canvas library | Confined to `adapters/reactFlowAdapter.ts` and the canvas component — the domain model is untouched. |
| Schema migrations | `model/types.ts` carries a `version`; `serialization/yaml.ts` is the migration choke point. |
| Multi-repo / history / metrics | New services alongside `AtlasFileService`, feeding the same model into the same panel. |

The throughline: **the model is decoupled from everything**, so new capabilities
attach to the model rather than threading through the UI.
