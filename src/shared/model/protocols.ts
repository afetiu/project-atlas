/**
 * Registry of connection protocols.
 *
 * Like the node-type registry, this is a single extension point: add an entry
 * to `PROTOCOLS` and the whole UI picks it up. Edge labels and the side panel
 * read from here rather than hard-coding protocol names.
 */

export const PROTOCOL_IDS = [
  'http',
  'grpc',
  'graphql',
  'kafka',
  'rabbitmq',
  'redis',
  'custom',
] as const;

export type ProtocolId = (typeof PROTOCOL_IDS)[number];

export interface ProtocolDefinition {
  id: ProtocolId;
  label: string;
}

export const PROTOCOLS: Record<ProtocolId, ProtocolDefinition> = {
  http: { id: 'http', label: 'HTTP' },
  grpc: { id: 'grpc', label: 'gRPC' },
  graphql: { id: 'graphql', label: 'GraphQL' },
  kafka: { id: 'kafka', label: 'Kafka' },
  rabbitmq: { id: 'rabbitmq', label: 'RabbitMQ' },
  redis: { id: 'redis', label: 'Redis' },
  custom: { id: 'custom', label: 'Custom' },
};

export const PROTOCOL_LIST: ProtocolDefinition[] = PROTOCOL_IDS.map((id) => PROTOCOLS[id]);

export const DEFAULT_PROTOCOL: ProtocolId = 'http';

export function isProtocolId(value: unknown): value is ProtocolId {
  return typeof value === 'string' && (PROTOCOL_IDS as readonly string[]).includes(value);
}

export function getProtocolLabel(id: ProtocolId): string {
  return PROTOCOLS[id].label;
}
