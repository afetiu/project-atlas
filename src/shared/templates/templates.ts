/**
 * Starter architecture templates.
 *
 * A blank canvas is intimidating; these give a first-time user a sensible,
 * editable graph for a common shape (microservices, hexagonal, event-driven,
 * monolith). Each is a pure factory returning a complete {@link ArchitectureModel}
 * with auto-laid-out positions, so it drops straight onto the canvas.
 */

import { computeLayout } from '../model/layout';
import { groupColorForIndex } from '../model/groups';
import { CURRENT_MODEL_VERSION, type ArchitectureModel } from '../model/types';
import type { NodeTypeId } from '../model/nodeTypes';
import type { ProtocolId } from '../model/protocols';

export interface ArchitectureTemplate {
  id: string;
  name: string;
  description: string;
  build(): ArchitectureModel;
}

interface NodeSpec {
  id: string;
  name: string;
  type: NodeTypeId;
  group?: string;
}
interface EdgeSpec {
  from: string;
  to: string;
  protocol?: ProtocolId;
}

/** Assemble a model from compact specs, laying it out deterministically. */
function make(nodes: NodeSpec[], edges: EdgeSpec[]): ArchitectureModel {
  const groupNames = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
  const groupId = new Map(groupNames.map((name, i) => [name, `ctx-${i + 1}`]));
  const groups = groupNames.map((name, i) => ({
    id: groupId.get(name)!,
    name,
    color: groupColorForIndex(i),
  }));

  const built = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    description: '',
    position: { x: 0, y: 0 },
    ...(n.group ? { groupId: groupId.get(n.group) } : {}),
  }));

  const builtEdges = edges.map((e, i) => ({
    id: `e${i + 1}-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    protocol: e.protocol ?? ('http' as ProtocolId),
  }));

  const positions = computeLayout(built, builtEdges);
  for (const node of built) {
    node.position = positions.get(node.id) ?? node.position;
  }

  return { version: CURRENT_MODEL_VERSION, nodes: built, edges: builtEdges, groups };
}

export const TEMPLATES: ArchitectureTemplate[] = [
  {
    id: 'microservices',
    name: 'Microservices',
    description: 'A gateway fronting independent services, each with its own datastore.',
    build: () =>
      make(
        [
          { id: 'web', name: 'Web App', type: 'frontend', group: 'Edge' },
          { id: 'gateway', name: 'API Gateway', type: 'service', group: 'Edge' },
          { id: 'orders', name: 'Orders Service', type: 'service', group: 'Orders' },
          { id: 'orders-db', name: 'Orders DB', type: 'database', group: 'Orders' },
          { id: 'users', name: 'Users Service', type: 'service', group: 'Users' },
          { id: 'users-db', name: 'Users DB', type: 'database', group: 'Users' },
          { id: 'cache', name: 'Cache', type: 'cache', group: 'Edge' },
        ],
        [
          { from: 'web', to: 'gateway' },
          { from: 'gateway', to: 'cache', protocol: 'redis' },
          { from: 'gateway', to: 'orders', protocol: 'grpc' },
          { from: 'gateway', to: 'users', protocol: 'grpc' },
          { from: 'orders', to: 'orders-db' },
          { from: 'users', to: 'users-db' },
        ],
      ),
  },
  {
    id: 'hexagonal',
    name: 'Hexagonal (Ports & Adapters)',
    description: 'A core domain isolated behind adapters for UI, persistence, and external APIs.',
    build: () =>
      make(
        [
          { id: 'ui', name: 'UI Adapter', type: 'frontend', group: 'Adapters' },
          { id: 'api', name: 'REST Adapter', type: 'service', group: 'Adapters' },
          { id: 'core', name: 'Domain Core', type: 'service', group: 'Domain' },
          { id: 'repo', name: 'Persistence Adapter', type: 'service', group: 'Adapters' },
          { id: 'db', name: 'Database', type: 'database', group: 'Infrastructure' },
          { id: 'payments', name: 'Payments API', type: 'externalApi', group: 'Infrastructure' },
        ],
        [
          { from: 'ui', to: 'api' },
          { from: 'api', to: 'core' },
          { from: 'core', to: 'repo' },
          { from: 'repo', to: 'db' },
          { from: 'core', to: 'payments', protocol: 'http' },
        ],
      ),
  },
  {
    id: 'event-driven',
    name: 'Event-driven',
    description: 'Producers and consumers decoupled through a message broker.',
    build: () =>
      make(
        [
          { id: 'web', name: 'Web App', type: 'frontend', group: 'Edge' },
          { id: 'api', name: 'API Service', type: 'service', group: 'Edge' },
          { id: 'bus', name: 'Event Bus', type: 'queue', group: 'Messaging' },
          { id: 'orders', name: 'Order Processor', type: 'service', group: 'Workers' },
          { id: 'notify', name: 'Notifier', type: 'service', group: 'Workers' },
          { id: 'db', name: 'Read Model', type: 'database', group: 'Workers' },
        ],
        [
          { from: 'web', to: 'api' },
          { from: 'api', to: 'bus', protocol: 'kafka' },
          { from: 'bus', to: 'orders', protocol: 'kafka' },
          { from: 'bus', to: 'notify', protocol: 'kafka' },
          { from: 'orders', to: 'db' },
        ],
      ),
  },
  {
    id: 'monolith',
    name: 'Modular monolith',
    description: 'A single application with internal modules over a shared database.',
    build: () =>
      make(
        [
          { id: 'web', name: 'Web App', type: 'frontend', group: 'Client' },
          { id: 'app', name: 'Application', type: 'service', group: 'Monolith' },
          { id: 'db', name: 'Database', type: 'database', group: 'Monolith' },
          { id: 'cache', name: 'Cache', type: 'cache', group: 'Monolith' },
        ],
        [
          { from: 'web', to: 'app' },
          { from: 'app', to: 'db' },
          { from: 'app', to: 'cache', protocol: 'redis' },
        ],
      ),
  },
];

export function getTemplate(id: string): ArchitectureTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
