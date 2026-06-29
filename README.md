# Atlas

**A visual architecture workspace for VS Code where the architecture model is the source of truth.**

Atlas is not a diagramming tool. It is the foundation for treating your system's
architecture as a first-class, editable model — one that lives in your
repository as a plain `atlas.yaml` file and stays in lock-step with a clean,
interactive canvas.

```
Architecture Canvas
        ↓
   atlas.yaml   ← source of truth
        ↓
    AI Agent          (future)
        ↓
   Code Changes       (future)
        ↓
    Git Diff          (future)
```

This repository is **Phase 1 (MVP)**: the visual architecture editor. It proves
that architecture can be edited visually and persisted as a versionable model.
AI code generation and the other roadmap items are intentionally **not**
implemented yet — but the codebase is structured so they can plug in naturally.

---

## Features

- **`Atlas: Open Architecture` command** — launches the architecture canvas in a
  Webview panel.
- **Interactive canvas** (built on [React Flow](https://reactflow.dev)) — drag &
  drop, zoom, pan, select, move, and connect nodes.
- **Six node types** — Service, Database, Queue, External API, Frontend, Cache.
- **Typed connections** — HTTP, gRPC, GraphQL, Kafka, RabbitMQ, Redis, Custom.
- **`atlas.yaml` as the single source of truth** — the entire graph serializes
  to your workspace root and stays bi-directionally synchronized: edit the
  canvas and the file updates; edit the file and the canvas updates.
- **Inspector side panel** — click a node or connection to edit its fields.
- **Auto-save** — every change is debounced and written to disk. No save button.
- **Validation** — duplicate IDs, broken edges, and invalid YAML are caught
  before they corrupt the model.
- **Modern dark-first UI** — clean, rounded, minimal. Linear × Raycast × VS Code.

---

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org) 18+ and npm
- [VS Code](https://code.visualstudio.com) 1.85+

### Install & build

```bash
npm install
npm run build
```

### Run it

1. Open this folder in VS Code.
2. Press <kbd>F5</kbd> (**Run Atlas Extension**). A second VS Code window — the
   Extension Development Host — opens.
3. In that window, open any folder, then run **`Atlas: Open Architecture`** from
   the Command Palette (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).
4. Drag a component from the palette onto the canvas. Watch `atlas.yaml` appear
   at the workspace root and update as you edit.

To try it with sample data, copy [`atlas.example.yaml`](./atlas.example.yaml)
to `atlas.yaml` in your test workspace before opening the canvas.

---

## Usage

| Action | How |
| --- | --- |
| Add a node | Drag a component from the left palette onto the canvas (or click it) |
| Move a node | Drag it |
| Connect nodes | Drag from a node's right handle to another node's left handle |
| Select | Click a node or connection |
| Edit | Use the inspector panel on the right |
| Delete | Select, then press <kbd>Backspace</kbd>/<kbd>Delete</kbd> or use the inspector |
| Pan / zoom | Drag the canvas / scroll or pinch |

All edits auto-save to `atlas.yaml`.

### The `atlas.yaml` format

```yaml
version: 1
nodes:
  - id: api-gateway
    name: API Gateway
    type: service          # service | database | queue | externalApi | frontend | cache
    description: Routes requests to internal services.
    position: { x: 360, y: 80 }
edges:
  - id: edge-api-gateway-orders
    source: api-gateway
    target: orders-service
    protocol: grpc         # http | grpc | graphql | kafka | rabbitmq | redis | custom
```

The file is plain, diff-friendly YAML — commit it alongside your code and review
architecture changes in pull requests like any other artifact.

---

## Documentation

- [**Architecture**](./docs/ARCHITECTURE.md) — how the extension is structured
  and why, plus the extension points designed for future growth.
- [**Development**](./docs/DEVELOPMENT.md) — local setup, build pipeline,
  project layout, and how to add a node type or protocol.

---

## Roadmap

Phase 1 deliberately stops at the visual editor. The architecture is designed so
that each of the following can be added without reworking the core:

- AI code generation from the model
- Live architecture ↔ code sync
- Git integration & architecture history
- Deeper architecture validation rules
- Deployment & Kubernetes visualization
- Runtime metrics overlays
- DDD bounded contexts, sequence diagrams, event-flow views
- ADR generation
- Multi-repository workspaces

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#extension-points) for the
concrete extension points each of these would hook into.

---

## License

MIT — see [LICENSE](./LICENSE).
