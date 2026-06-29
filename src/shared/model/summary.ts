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
  const lines: string[] = [];

  lines.push(`Components (${model.nodes.length}):`);
  for (const node of model.nodes) {
    const def = getNodeTypeDefinition(node.type);
    const where = node.mapping?.path ? ` [${node.mapping.path}]` : '';
    const desc = node.description ? ` — ${node.description}` : '';
    lines.push(`- ${node.name} (${def.label})${where}${desc}`);
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
