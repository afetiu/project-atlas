/**
 * Export the architecture model to portable formats for docs and PRs:
 *   - Mermaid (a `flowchart` with bounded contexts as subgraphs),
 *   - Markdown (a readable summary).
 * Pure functions of the model, so they work in the extension and the CLI alike.
 */

import { getProtocolLabel } from '../model/protocols';
import { getNodeTypeDefinition } from '../model/nodeTypes';
import { summarizeModel } from '../model/summary';
import type { ArchitectureModel, ArchitectureNode } from '../model/types';

export function toMermaid(model: ArchitectureModel): string {
  const safe = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');
  const decl = (node: ArchitectureNode) =>
    `${safe(node.id)}["${escapeLabel(node.name)}"]`;

  const lines: string[] = ['flowchart LR'];
  const groupName = new Map(model.groups.map((g) => [g.id, g.name]));
  const byGroup = new Map<string, ArchitectureNode[]>();
  const ungrouped: ArchitectureNode[] = [];
  for (const node of model.nodes) {
    if (node.groupId && groupName.has(node.groupId)) {
      const list = byGroup.get(node.groupId) ?? [];
      list.push(node);
      byGroup.set(node.groupId, list);
    } else {
      ungrouped.push(node);
    }
  }

  for (const [groupId, nodes] of byGroup) {
    lines.push(`  subgraph ${safe(groupId)}["${escapeLabel(groupName.get(groupId)!)}"]`);
    for (const node of nodes) {
      lines.push(`    ${decl(node)}`);
    }
    lines.push('  end');
  }
  for (const node of ungrouped) {
    lines.push(`  ${decl(node)}`);
  }
  for (const edge of model.edges) {
    lines.push(
      `  ${safe(edge.source)} -->|${escapeLabel(getProtocolLabel(edge.protocol))}| ${safe(edge.target)}`,
    );
  }
  return lines.join('\n');
}

export function toMarkdown(model: ArchitectureModel): string {
  const lines = ['# Architecture', '', '```mermaid', toMermaid(model), '```', ''];
  lines.push('## Components', '');
  lines.push('| Component | Type | Code | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const node of model.nodes) {
    const def = getNodeTypeDefinition(node.type);
    const path = node.mapping?.path ? `\`${node.mapping.path}\`` : '';
    lines.push(`| ${node.name} | ${def.label} | ${path} | ${node.description.replace(/\|/g, '\\|')} |`);
  }
  lines.push('', '---', '', summarizeModel(model));
  return lines.join('\n');
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, ' ');
}
