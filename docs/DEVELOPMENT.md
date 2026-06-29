# Development

## Prerequisites

- Node.js 18+ and npm
- VS Code 1.85+

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
│   ├── model/              types + node-type & protocol registries
│   ├── serialization/      yaml (de)serialization + validation
│   └── messaging/          host ⇄ webview message contract
├── extension/              VS Code extension host
│   ├── extension.ts        activation entry point
│   ├── commands/           command registrations
│   ├── panel/              webview panel + HTML shell
│   └── workspace/          atlas.yaml file service
└── webview/                React canvas application
    ├── index.tsx           app entry
    ├── vscodeApi.ts        typed host bridge
    ├── model/              webview state hook + id helpers
    ├── adapters/           domain ⇄ React Flow translation
    ├── components/         UI components
    └── styles/             theme
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
