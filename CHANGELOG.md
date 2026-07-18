# Changelog

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
