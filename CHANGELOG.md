# Changelog

## 0.2.3 — 2026-08-08

- **New: `atlas-studio`**, a standalone visual canvas — `npx -p
  atlas-architecture-mcp atlas-studio /path/to/repo` opens the same webview
  canvas the extension ships (drag-and-drop editing, Detect with AI, chat,
  apply/codegen, drift/sync status, plans and ADRs, time-lapse history) in a
  browser, with no VS Code or Cursor involved. Backed by a small local
  HTTP+WebSocket server; AI auth is env-var only for now (`ANTHROPIC_API_KEY`
  / `OPENAI_API_KEY` / `GEMINI_API_KEY`, or an existing `claude` CLI login) —
  see the `atlas-architecture-mcp` README for the full env-var reference and
  known v1 gaps.

## 0.2.2 — 2026-08-08

- Fixed Claude Code detection on Windows: current `@anthropic-ai/claude-code`
  npm releases ship a native `bin/claude.exe` (declared in the package's own
  `package.json#bin`), not the `cli.js` Atlas's shim-resolver assumed. Atlas
  now reads the package's declared bin entry instead of hardcoding a path, so
  it stops reporting "could not run the claude CLI" when the CLI works fine
  from a terminal.

## 0.2.1 — 2026-08-08

- Renamed the extension id from `atlas` to `atlas-architecture-workspace`
  (`afetiu.atlas-architecture-workspace`) — the Marketplace rejected the bare
  `atlas` name as a collision. Display name is unchanged.

## 0.2.0 — 2026-07-18

The multi-provider, multi-agent release: every AI feature now works without
the `claude` CLI, in VS Code and Cursor alike, and any MCP-capable agent can
drive the architecture map.

### AI engines

- **Bring your own key.** Detect, Chat, and Apply → codegen now run on either
  the Claude Agent SDK (your Claude Code login, as before) or Atlas's built-in
  agent loop with a direct provider API: **Anthropic** (`claude-opus-4-8`),
  **OpenAI** (`gpt-5.6`), or **Google Gemini** (`gemini-flash-latest`).
- New `atlas.provider` setting (`auto` prefers Claude Code, then the first
  stored key) and per-provider model overrides (`atlas.openai.model`,
  `atlas.gemini.model`).
- `Atlas: Set AI API Key` / `Clear AI API Key` gained a provider picker; keys
  live in VS Code SecretStorage.
- Identical sandboxing on every engine: no shell, writes confined to the
  workspace via symlink-aware containment, all changes revertable.
- The active engine is shown in the panel status while a job runs.

### Agent interop

- **`Atlas: Register MCP Server` supports five clients**: Claude Code, Cursor,
  Windsurf, Gemini CLI, and Codex CLI — each config merged non-destructively
  and updated in place on re-run.
- **New npm package [`atlas-architecture-mcp`](https://www.npmjs.com/package/atlas-architecture-mcp)**:
  the MCP server plus `atlas-check` / `atlas-diff` CLIs, runnable via `npx`
  with no VS Code installed — for terminal-only agents and CI PR gates.

### Also in this release

- Plans workflow: propose → assess → decide → build, with decided plans
  tracked against reality and ADR export.
- Time-lapse: scrub through the map's git history.
- Docs experience: the workspace's Markdown catalogued, linked, and readable
  in-panel; focus mode with explicit district affordance.
- Headless UI test suite and interaction hardening (three real canvas fixes).
- Marketplace packaging: icon, gallery banner, VSIX hygiene.

## 0.1.0

Initial release: the visual architecture editor — React Flow canvas over a
diff-friendly `atlas.yaml`, bounded contexts, architecture rules with an
Issues panel, Mermaid/Markdown export, and layout kept in a separate
`atlas.layout.yaml` sidecar so reviews stay clean.
