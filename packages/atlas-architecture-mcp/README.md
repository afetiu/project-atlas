# atlas-architecture-mcp

Headless [Atlas](https://github.com/afetiu/project-atlas): the MCP server and
rules CLI for the Atlas architecture workspace, with **no VS Code required**.
Use it to let any MCP-capable agent — Claude Code, Cursor, Windsurf, Gemini
CLI, Codex — read and edit a repo's `atlas.yaml` architecture map, and to gate
pull requests on architecture rules in CI.

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

## The full experience

The [Atlas VS Code extension](https://github.com/afetiu/project-atlas) adds
the visual canvas, AI detection/chat/codegen, and live sync on top of the same
`atlas.yaml`. This package is built from the same source.
