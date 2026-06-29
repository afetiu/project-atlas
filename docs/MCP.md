# Atlas MCP Server

Atlas ships a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes the live architecture map (`atlas.yaml`) to MCP clients — most
usefully, your existing **Claude Code**. With it connected, you can read and
edit the architecture from a normal Claude Code session, and the changes appear
on the Atlas canvas immediately (Atlas watches `atlas.yaml`).

## Why

Atlas's own canvas and copilot are one way to edit the map. The MCP server is a
second, complementary door: it lets the AI you already use become
architecture-aware without leaving its normal workflow.

## Setup

From a workspace that has Atlas installed, run the command:

```
Atlas: Register MCP Server
```

This writes (or merges into) `.mcp.json` at the workspace root:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": ["<extension>/dist/mcp-server.mjs"],
      "env": { "ATLAS_WORKSPACE": "<your workspace path>" }
    }
  }
}
```

Restart Claude Code so it picks up the new server. Confirm it loaded with `/mcp`.

## Tools

| Tool | Description |
| --- | --- |
| `get_architecture_model` | Return the full model as JSON. |
| `describe_architecture` | Concise human-readable summary. |
| `check_architecture` | Evaluate the built-in architecture rules and return violations. |
| `add_node` | Add a component (`name`, `type?`, `description?`, `path?`). |
| `update_node` | Update a component by `id`. |
| `remove_node` | Remove a component and any connections touching it. |
| `connect` | Connect two components (`source`, `target`, `protocol?`). |
| `disconnect` | Remove a connection. |
| `assign_to_group` | Add a component to a bounded context, creating it if needed. |
| `remove_from_group` | Remove a component from its bounded context. |

Every mutation is validated against the same invariants the extension enforces,
then written to `atlas.yaml`. Invalid operations return an error and leave the
file untouched.

## Example

In Claude Code:

> Read the Atlas architecture, then add a Redis cache called "Session Cache" in
> front of the API gateway.

Claude calls `describe_architecture`, then `add_node` and `connect`. Switch back
to the Atlas panel — the new node and edge are already there.
