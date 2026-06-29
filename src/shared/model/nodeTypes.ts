/**
 * Registry of supported node types.
 *
 * New node types plug in by adding a single entry to `NODE_TYPES`. Nothing
 * else in the codebase hard-codes the list — the UI, validation, and the side
 * panel all derive their behaviour from this registry. This is the primary
 * extension point for Atlas's "future expansion" goals.
 */

export const NODE_TYPE_IDS = [
  'service',
  'database',
  'queue',
  'externalApi',
  'frontend',
  'cache',
] as const;

export type NodeTypeId = (typeof NODE_TYPE_IDS)[number];

export interface NodeTypeDefinition {
  id: NodeTypeId;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Subtle accent colour used for the node's icon and border glow. */
  accent: string;
  /** Identifier for the icon component rendered in the webview. */
  icon: NodeTypeId;
}

export const NODE_TYPES: Record<NodeTypeId, NodeTypeDefinition> = {
  service: { id: 'service', label: 'Service', accent: '#7c93ff', icon: 'service' },
  database: { id: 'database', label: 'Database', accent: '#4fd1a1', icon: 'database' },
  queue: { id: 'queue', label: 'Queue', accent: '#f0a868', icon: 'queue' },
  externalApi: { id: 'externalApi', label: 'External API', accent: '#c792ea', icon: 'externalApi' },
  frontend: { id: 'frontend', label: 'Frontend', accent: '#56c5ff', icon: 'frontend' },
  cache: { id: 'cache', label: 'Cache', accent: '#ff8b8b', icon: 'cache' },
};

/** Ordered list of definitions, convenient for rendering menus. */
export const NODE_TYPE_LIST: NodeTypeDefinition[] = NODE_TYPE_IDS.map((id) => NODE_TYPES[id]);

export function isNodeTypeId(value: unknown): value is NodeTypeId {
  return typeof value === 'string' && (NODE_TYPE_IDS as readonly string[]).includes(value);
}

export function getNodeTypeDefinition(id: NodeTypeId): NodeTypeDefinition {
  return NODE_TYPES[id];
}
