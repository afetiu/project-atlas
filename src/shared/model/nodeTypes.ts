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
  // Earthy, chart-like categorical palette — warm and muted so the map reads
  // like a hand-inked chart in both the night (dark) and paper (light) themes.
  service: { id: 'service', label: 'Service', accent: '#c89b6c', icon: 'service' },
  database: { id: 'database', label: 'Database', accent: '#7fa98c', icon: 'database' },
  queue: { id: 'queue', label: 'Queue', accent: '#d9a253', icon: 'queue' },
  externalApi: { id: 'externalApi', label: 'External API', accent: '#a98bb8', icon: 'externalApi' },
  frontend: { id: 'frontend', label: 'Frontend', accent: '#6fa8a0', icon: 'frontend' },
  cache: { id: 'cache', label: 'Cache', accent: '#c57f6d', icon: 'cache' },
};

/** Ordered list of definitions, convenient for rendering menus. */
export const NODE_TYPE_LIST: NodeTypeDefinition[] = NODE_TYPE_IDS.map((id) => NODE_TYPES[id]);

export function isNodeTypeId(value: unknown): value is NodeTypeId {
  return typeof value === 'string' && (NODE_TYPE_IDS as readonly string[]).includes(value);
}

export function getNodeTypeDefinition(id: NodeTypeId): NodeTypeDefinition {
  return NODE_TYPES[id];
}
