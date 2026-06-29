/**
 * Human-readable summary of an architecture model.
 *
 * Shared so the MCP server (`describe_architecture`) and any future UI surface
 * describe the architecture identically.
 */

import { getNodeTypeDefinition } from './nodeTypes';
import { getProtocolLabel } from './protocols';
import type { ArchitectureModel } from './types';

export function summarizeModel(model: ArchitectureModel): string {
  if (model.nodes.length === 0) {
    return 'The architecture is empty.';
  }

  const nameOf = new Map(model.nodes.map((n) => [n.id, n.name]));
  const groupName = new Map(model.groups.map((g) => [g.id, g.name]));
  const lines: string[] = [];

  if (model.groups.length > 0) {
    lines.push(`Bounded contexts (${model.groups.length}): ${model.groups.map((g) => g.name).join(', ')}`, '');
  }

  lines.push(`Components (${model.nodes.length}):`);
  for (const node of model.nodes) {
    const def = getNodeTypeDefinition(node.type);
    const where = node.mapping?.path ? ` [${node.mapping.path}]` : '';
    const ctx = node.groupId && groupName.has(node.groupId) ? ` {${groupName.get(node.groupId)}}` : '';
    const desc = node.description ? ` — ${node.description}` : '';
    lines.push(`- ${node.name} (${def.label})${ctx}${where}${desc}`);
  }

  lines.push('', `Connections (${model.edges.length}):`);
  if (model.edges.length === 0) {
    lines.push('- none');
  } else {
    for (const edge of model.edges) {
      const source = nameOf.get(edge.source) ?? edge.source;
      const target = nameOf.get(edge.target) ?? edge.target;
      lines.push(`- ${source} → ${target} (${getProtocolLabel(edge.protocol)})`);
    }
  }

  return lines.join('\n');
}
