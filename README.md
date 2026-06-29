# Atlas

**A visual architecture workspace for VS Code where the architecture model is the source of truth — and code becomes a generated artifact.**

Atlas is not a diagramming tool. It is an editable "map of the world" for your
system: AI generates it from your real repository, you reshape it visually or by
talking to a copilot, and every structural change becomes a *proposed* code
change you review before it's applied.

```
        ┌──────────────────── Atlas workspace ────────────────────┐
Repo ──► AI detection ──► atlas.yaml ──► editable canvas + AI chat
                              ▲                    │
                              │     drag / connect / rename / chat
                              │                    ▼
                              └──── interpret ──► confirm ──► Apply
                                                               │
                                                               ▼
                                                    code generation ──► git diff
```

`atlas.yaml` lives in your repo as plain, diff-friendly YAML — the single source
of truth that the canvas, the AI, and (optionally) your existing Claude Code all
read and write.

---

## What it does

- **Detect architecture from code** — Claude analyzes the repository and
  produces the architecture map (components, connections, and the code path each
  component maps to).
- **Edit it visually** — drag & drop, zoom, pan, connect, and inspect on an
  interactive [React Flow](https://reactflow.dev) canvas.
- **Bounded contexts** — group components into domains, rendered as auto-fitted
  regions. Detection, chat, and Claude Code (via MCP) can all organize the map
  into contexts.
- **Talk to an architecture copilot** — ask questions, or describe a change
  (“add a Redis cache in front of the orders DB”). The AI replies and can return
  a proposal to apply.
- **Apply → generate code** — applying pending changes runs an agentic
  code-generation pass and shows you the resulting **git diff** to review.
- **`atlas.yaml` as source of truth** — the canvas and file stay synchronized in
  both directions; everything auto-saves.
- **MCP interop** — Atlas exposes the live map as an MCP server, so your existing
  Claude Code can read and edit the architecture too. Its edits appear on the
  canvas instantly.
- **Modern dark-first UI** — clean, rounded, minimal. Linear × Raycast × VS Code.

> Phase 1 was the visual editor. This release adds the AI layer (detection,
> chat, code generation) and the MCP server. See the [roadmap](#roadmap) for
> what's intentionally still ahead.

---

## How AI is wired in

Atlas talks to Claude two complementary ways:

| Layer | Powers | Mechanism |
| --- | --- | --- |
| **Atlas-native AI** | In-canvas *Detect*, *chat*, and *Apply → code* | [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) in the extension host |
| **MCP server** | Your existing Claude Code reading/editing the map | An MCP stdio server over `atlas.yaml` |

The Agent SDK runs the agentic loop (read the repo, return structured JSON, edit
files); the MCP server is a second door into the same `atlas.yaml`. Because both
write the one file, and Atlas watches that file, every change — wherever it comes
from — shows up live on the canvas.

---

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org) 18+ and npm
- [VS Code](https://code.visualstudio.com) 1.85+
- The [`claude` CLI](https://code.claude.com/docs) installed and logged in
  **or** an Anthropic API key (for the AI features)

### Install & build

```bash
npm install
npm run build
```

### Run it

1. Open this folder in VS Code and press <kbd>F5</kbd> (**Run Atlas Extension**).
2. In the Extension Development Host window, open a project folder.
3. Run **`Atlas: Open Architecture`** from the Command Palette.
4. Click **Detect from code** to generate the map — or drag components from the
   palette to draw one by hand.

### Authentication

Atlas prefers your existing Claude Code login (no setup needed if you're already
logged in). To use an explicit key instead, run **`Atlas: Set Anthropic API
Key`** — it's stored in VS Code SecretStorage. You can also pin a model or a
`claude` path in **Settings → Atlas**.

---

## Usage

| Action | How |
| --- | --- |
| Generate the map from code | **Detect from code** (toolbar) or `Atlas: Detect Architecture` |
| Add / move / connect / edit | Palette + canvas + the Inspector tab |
| Ask or request a change | The **Assistant** tab — chat with the copilot |
| Apply a chat proposal | **Apply & generate code** on the proposal card |
| Apply your own canvas edits | **Apply N changes** (toolbar) → review the diff |
| Let Claude Code edit the map | `Atlas: Register MCP Server`, then use Claude Code |

All architecture edits auto-save to `atlas.yaml`. Code changes are only made when
you explicitly apply, and are always shown as a diff first.

### The `atlas.yaml` format

```yaml
version: 1
nodes:
  - id: orders-service
    name: Orders Service
    type: service          # service | database | queue | externalApi | frontend | cache
    description: Owns the order lifecycle.
    position: { x: 360, y: 80 }
    groupId: orders            # optional bounded context membership
    mapping:
      path: src/services/orders   # links the component to its code
      language: typescript
      framework: express
edges:
  - id: edge-orders-service-orders-db
    source: orders-service
    target: orders-db
    protocol: grpc         # http | grpc | graphql | kafka | rabbitmq | redis | custom
groups:
  - id: orders
    name: Orders
    description: Order management bounded context.
    color: '#4fd1a1'
```

---

## Documentation

- [**Architecture**](./docs/ARCHITECTURE.md) — how the extension is structured,
  the AI and MCP layers, the sync model, and the extension points for future
  growth.
- [**Development**](./docs/DEVELOPMENT.md) — setup, build pipeline, project
  layout, and how to extend it.
- [**MCP**](./docs/MCP.md) — connecting the Atlas MCP server to Claude Code.

---

## Roadmap

Designed so each of these attaches to the model rather than threading through the
UI:

- Live architecture ↔ code sync (continuous, not just on demand)
- Deeper architecture validation & policy rules
- Deployment, Kubernetes, and runtime-metrics overlays
- DDD bounded contexts, sequence diagrams, event-flow views
- ADR generation & architecture history
- Multi-repository workspaces

---

## License

MIT — see [LICENSE](./LICENSE).
