/**
 * Atlas MCP server.
 *
 * A standalone stdio server that Claude Code launches on demand. It exposes the
 * live architecture map (`atlas.yaml`) as tools, so an ordinary Claude Code
 * session can read the architecture and propose/apply structural edits to it.
 * Because every mutation writes `atlas.yaml`, the extension's file watcher
 * reflects the change on the canvas immediately.
 *
 * Launched with `ATLAS_WORKSPACE` pointing at the workspace root (see the
 * `Atlas: Register MCP Server` command, which writes `.mcp.json`).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { NODE_TYPE_IDS } from '../shared/model/nodeTypes';
import { PROTOCOL_IDS } from '../shared/model/protocols';
import { groupColorForIndex } from '../shared/model/groups';
import { summarizeModel } from '../shared/model/summary';
import { evaluateRules } from '../shared/rules/rules';
import {
  assertSafePath,
  AtlasStore,
  coerceNodeType,
  coerceProtocol,
  findNode,
  makeUniqueId,
  withAutoLayout,
} from './atlasStore';

const nodeTypeEnum = z.enum(NODE_TYPE_IDS as unknown as [string, ...string[]]);
const protocolEnum = z.enum(PROTOCOL_IDS as unknown as [string, ...string[]]);

const workspaceDir = process.env.ATLAS_WORKSPACE || process.cwd();
const store = new AtlasStore(workspaceDir);

function text(message: string) {
  return { content: [{ type: 'text' as const, text: message }] };
}

const server = new McpServer({ name: 'atlas', version: '0.1.0' });

server.registerTool(
  'get_architecture_model',
  {
    description: 'Return the current Atlas architecture model (nodes and edges) as JSON.',
    inputSchema: {},
  },
  async () => text(JSON.stringify(await store.read(), null, 2)),
);

server.registerTool(
  'describe_architecture',
  {
    description: 'Return a concise human-readable summary of the architecture.',
    inputSchema: {},
  },
  async () => text(summarizeModel(await store.read())),
);

server.registerTool(
  'check_architecture',
  {
    description: 'Evaluate Atlas architecture rules and return any violations.',
    inputSchema: {},
  },
  async () => {
    const violations = evaluateRules(await store.read());
    if (violations.length === 0) {
      return text('No architecture issues found.');
    }
    return text(violations.map((v) => `[${v.severity}] ${v.message}`).join('\n'));
  },
);

server.registerTool(
  'add_node',
  {
    description: 'Add a component to the architecture.',
    inputSchema: {
      name: z.string(),
      type: nodeTypeEnum.optional(),
      description: z.string().optional(),
      path: z.string().optional(),
    },
  },
  async ({ name, type, description, path }) => {
    if (path) {
      assertSafePath(path);
    }
    const id = await store.mutate((model) => {
      const newId = makeUniqueId(
        model.nodes.map((n) => n.id),
        name,
      );
      const node = {
        id: newId,
        name,
        type: coerceNodeType(type ?? 'service'),
        description: description ?? '',
        position: { x: 0, y: 0 },
        ...(path ? { mapping: { path } } : {}),
      };
      return { model: withAutoLayout({ ...model, nodes: [...model.nodes, node] }), result: newId };
    });
    return text(`Added node "${name}" with id "${id}".`);
  },
);

server.registerTool(
  'update_node',
  {
    description: 'Update an existing component by id.',
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      type: nodeTypeEnum.optional(),
      description: z.string().optional(),
      path: z.string().optional(),
    },
  },
  async (args) => {
    if (args.path) {
      assertSafePath(args.path);
    }
    await store.mutate((model) => {
      if (!findNode(model, args.id)) {
        throw new Error(`No node with id "${args.id}".`);
      }
      const nodes = model.nodes.map((node) =>
        node.id === args.id
          ? {
              ...node,
              ...(args.name !== undefined ? { name: args.name } : {}),
              ...(args.type !== undefined ? { type: coerceNodeType(args.type) } : {}),
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.path !== undefined
                ? { mapping: { ...(node.mapping ?? {}), path: args.path } }
                : {}),
            }
          : node,
      );
      return { model: { ...model, nodes }, result: null };
    });
    return text(`Updated node "${args.id}".`);
  },
);

server.registerTool(
  'remove_node',
  {
    description: 'Remove a component and any connections that touch it.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    await store.mutate((model) => ({
      model: {
        ...model,
        nodes: model.nodes.filter((node) => node.id !== id),
        edges: model.edges.filter((edge) => edge.source !== id && edge.target !== id),
      },
      result: null,
    }));
    return text(`Removed node "${id}".`);
  },
);

server.registerTool(
  'connect',
  {
    description: 'Connect two components with a protocol.',
    inputSchema: { source: z.string(), target: z.string(), protocol: protocolEnum.optional() },
  },
  async ({ source, target, protocol }) => {
    const outcome = await store.mutate((model) => {
      if (!findNode(model, source) || !findNode(model, target)) {
        throw new Error('Both source and target nodes must exist.');
      }
      if (source === target) {
        throw new Error('Cannot connect a node to itself.');
      }
      if (model.edges.some((e) => e.source === source && e.target === target)) {
        return { model, result: 'exists' as const };
      }
      const edgeId = makeUniqueId(
        model.edges.map((e) => e.id),
        `edge-${source}-${target}`,
      );
      const edge = { id: edgeId, source, target, protocol: coerceProtocol(protocol) };
      return { model: { ...model, edges: [...model.edges, edge] }, result: 'added' as const };
    });
    return text(
      outcome === 'exists'
        ? `${source} → ${target} already connected.`
        : `Connected ${source} → ${target}.`,
    );
  },
);

server.registerTool(
  'disconnect',
  {
    description: 'Remove the connection between two components.',
    inputSchema: { source: z.string(), target: z.string() },
  },
  async ({ source, target }) => {
    await store.mutate((model) => ({
      model: {
        ...model,
        edges: model.edges.filter((e) => !(e.source === source && e.target === target)),
      },
      result: null,
    }));
    return text(`Disconnected ${source} → ${target}.`);
  },
);

server.registerTool(
  'assign_to_group',
  {
    description:
      'Assign a component to a bounded context (domain), creating the context if it does not exist yet.',
    inputSchema: { nodeId: z.string(), group: z.string() },
  },
  async ({ nodeId, group }) => {
    const groupId = await store.mutate((model) => {
      if (!findNode(model, nodeId)) {
        throw new Error(`No node with id "${nodeId}".`);
      }
      let target = model.groups.find((g) => g.name.toLowerCase() === group.toLowerCase());
      let groups = model.groups;
      if (!target) {
        target = {
          id: makeUniqueId(model.groups.map((g) => g.id), group),
          name: group,
          color: groupColorForIndex(model.groups.length),
        };
        groups = [...model.groups, target];
      }
      const nodes = model.nodes.map((n) => (n.id === nodeId ? { ...n, groupId: target!.id } : n));
      return { model: { ...model, nodes, groups }, result: target.id };
    });
    return text(`Assigned "${nodeId}" to context "${group}" (${groupId}).`);
  },
);

server.registerTool(
  'remove_from_group',
  {
    description: 'Remove a component from its bounded context.',
    inputSchema: { nodeId: z.string() },
  },
  async ({ nodeId }) => {
    await store.mutate((model) => ({
      model: {
        ...model,
        nodes: model.nodes.map((n) => {
          if (n.id !== nodeId) {
            return n;
          }
          const rest = { ...n };
          delete rest.groupId;
          return rest;
        }),
      },
      result: null,
    }));
    return text(`Removed "${nodeId}" from its context.`);
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the protocol; log to stderr.
  console.error(`[atlas-mcp] serving ${workspaceDir}/atlas.yaml`);
}

main().catch((error) => {
  console.error('[atlas-mcp] fatal:', error);
  process.exit(1);
});
