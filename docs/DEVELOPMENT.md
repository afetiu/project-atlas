# Development

## Prerequisites

- Node.js 18+ and npm
- VS Code 1.85+
- For the AI features: the `claude` CLI installed and logged in, **or** an
  Anthropic API key (`Atlas: Set Anthropic API Key`)

`npm run build` emits three bundles into `dist/`:
`extension.js` (host, CJS), `webview.js`/`webview.css` (canvas, IIFE), and
`mcp-server.mjs` (MCP server, ESM). The Agent SDK is intentionally **not**
bundled — it is loaded at runtime via dynamic `import()` (see
[ARCHITECTURE.md](./ARCHITECTURE.md#ai-integration-choices)).

## Setup

```bash
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Production build of both bundles into `dist/`. |
| `npm run compile` | Development build (sourcemaps, unminified). |
| `npm run watch` | Rebuild both bundles on change. |
| `npm run typecheck` | `tsc --noEmit` across the whole tree. |
| `npm run lint` | ESLint over `src`. |
| `npm run package` | Produce a `.vsix` (requires `@vscode/vsce`). |

## Run in the Extension Development Host

1. Open the repo in VS Code.
2. Press <kbd>F5</kbd> → **Run Atlas Extension**. This runs `npm: compile` first
   (see [`.vscode/tasks.json`](../.vscode/tasks.json)) and launches a second
   VS Code window.
3. In that window open a folder, then run **`Atlas: Open Architecture`**.

For a fast inner loop, run `npm run watch` in a terminal and use
<kbd>Cmd/Ctrl</kbd>+<kbd>R</kbd> to reload the Extension Development Host after a
rebuild.

## Project layout

```
src/
├── shared/                 framework-agnostic domain core
│   ├── model/              types, registries, diff, layout, summary
│   ├── serialization/      yaml (de)serialization + validation
│   ├── ai/                 AI JSON-schema contracts + normalizers
│   └── messaging/          host ⇄ webview message contract
├── extension/              VS Code extension host
│   ├── extension.ts        activation entry point
│   ├── commands/           command registrations
│   ├── panel/              webview panel + AI orchestration
│   ├── ai/                 ClaudeAgent, AuthProvider, prompts
│   └── workspace/          file service, baseline store, git diff
├── webview/                React canvas application
│   ├── model/              graph + AI session hooks
│   ├── adapters/           domain ⇄ React Flow translation
│   ├── components/         UI components
│   └── styles/             theme
└── mcp/                    standalone MCP server over atlas.yaml
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the rationale behind this layout.

## How to: add a node type

1. Add an id to `NODE_TYPE_IDS` and a definition to `NODE_TYPES` in
   [`src/shared/model/nodeTypes.ts`](../src/shared/model/nodeTypes.ts).
2. Add an icon for it in
   [`src/webview/components/NodeIcon.tsx`](../src/webview/components/NodeIcon.tsx).

That's it — the palette, inspector dropdown, and validation all derive from the
registry.

## How to: add a protocol

Add an id to `PROTOCOL_IDS` and a definition to `PROTOCOLS` in
[`src/shared/model/protocols.ts`](../src/shared/model/protocols.ts). The edge
labels and inspector dropdown update automatically.

## How to: add an MCP tool

Register it in [`src/mcp/server.ts`](../src/mcp/server.ts) with `registerTool`
and a Zod input schema, mutating through `AtlasStore.mutate` so the result is
validated before it is written. Rebuild and reconnect Claude Code.

## How to: tune the AI

Prompts live in [`src/extension/ai/prompts.ts`](../src/extension/ai/prompts.ts);
the structured-output schemas live in
[`src/shared/ai/`](../src/shared/ai). The Agent SDK call sites (tools allowed,
permission mode, model) are in
[`src/extension/ai/ClaudeAgent.ts`](../src/extension/ai/ClaudeAgent.ts).

## How to: add a host ⇄ webview message

Add a variant to the relevant union in
[`src/shared/messaging/protocol.ts`](../src/shared/messaging/protocol.ts), then
handle it in `ArchitecturePanel` (host) and/or `useArchitectureModel` (webview).
TypeScript's exhaustive `switch` checks will point you at every site that needs
updating.

## Conventions

- **Strict TypeScript.** `strict`, `noUnusedLocals`, `noUnusedParameters`, and
  `noImplicitOverride` are all on. Keep the tree warning-free.
- **No new dependencies without cause.** The runtime deps are deliberately
  minimal: React, React Flow, and a YAML parser.
- **Comments explain *why*, not *what*.** Prefer readable code; comment the
  non-obvious decisions (e.g. the write-echo suppression).
- **Small files, single responsibility.** If a module starts doing two things,
  split it.
