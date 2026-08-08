# atlas-architecture-mcp

Headless [Atlas](https://github.com/afetiu/project-atlas): the MCP server,
rules CLI, and standalone visual studio for the Atlas architecture workspace,
with **no VS Code required**. Use it to let any MCP-capable agent — Claude
Code, Cursor, Windsurf, Gemini CLI, Codex — read and edit a repo's
`atlas.yaml` architecture map, to gate pull requests on architecture rules in
CI, or to open the visual canvas directly in a browser.

## MCP server

Add to your agent's MCP config (example: Claude Code's `.mcp.json`):

```json
{
  "mcpServers": {
    "atlas": {
      "command": "npx",
      "args": ["-y", "atlas-architecture-mcp"],
      "env": { "ATLAS_WORKSPACE": "/path/to/your/repo" }
    }
  }
}
```

`ATLAS_WORKSPACE` defaults to the directory the server is launched from.
Tools exposed: `get_architecture_model`, `describe_architecture`,
`check_architecture`, `add_node`, `update_node`, `remove_node`, `connect`,
`disconnect`, `assign_to_group`, `remove_from_group`. Every mutation is
validated before it is written to `atlas.yaml`.

## Rules check (CI / PR gate)

```bash
npx -p atlas-architecture-mcp atlas-check          # check ./atlas.yaml
npx -p atlas-architecture-mcp atlas-check --strict # any violation fails the build
```

Built-in rules (frontend reaching a datastore directly, unmapped components,
orphaned nodes, …) plus your own in `atlas.rules.yaml`.

## Diff

```bash
npx -p atlas-architecture-mcp atlas-diff base/atlas.yaml head/atlas.yaml
```

Human-readable summary of what changed between two versions of the map —
useful in PR descriptions.

## Standalone studio (the visual canvas, no editor)

```bash
npx -p atlas-architecture-mcp atlas-studio /path/to/your/repo
```

Opens the same canvas the VS Code extension ships — drag-and-drop editing,
"Detect with AI", chat, apply/codegen, drift and sync status, plans and ADRs,
time-lapse history — in your browser, served from a small local server. No
VS Code, no Cursor.

- Defaults to the current directory and port `4700`; override with
  `--port=N` and skip the auto-opened browser tab with `--no-open`.
- AI auth is env-var only for now (no in-app key entry): set
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`/`GOOGLE_API_KEY`,
  or just be logged into the `claude` CLI already — same auto-detection as
  the extension. `ATLAS_PROVIDER`, `ATLAS_CLAUDE_PATH`, `ATLAS_MODEL` /
  `ATLAS_OPENAI_MODEL` / `ATLAS_GEMINI_MODEL`, `ATLAS_SOURCE_ROOT`,
  `ATLAS_AUTO_SYNC`, `ATLAS_VERIFY_COMMAND`, and `ATLAS_MCP_SERVERS` (JSON)
  mirror the extension's `atlas.*` settings.
- Deliberately not wired up yet: opening a mapped file in an external editor
  (no editor to hand off to from a browser tab), and live drift refresh on
  Linux setups where Node's recursive `fs.watch` isn't available (drift still
  recomputes on every manual action either way).

## The full experience

The [Atlas VS Code extension](https://github.com/afetiu/project-atlas) adds
the same visual canvas, AI detection/chat/codegen, and live sync inside your
editor. This package is built from the same source.
