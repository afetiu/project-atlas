/**
 * Export the architecture model to portable formats for docs and PRs:
 *   - Mermaid (a `flowchart` with bounded contexts as subgraphs),
 *   - Markdown (a readable summary).
 * Pure functions of the model, so they work in the extension and the CLI alike.
 */

import { computeLayout } from '../model/layout';
import { getProtocolLabel } from '../model/protocols';
import { getNodeTypeDefinition } from '../model/nodeTypes';
import { summarizeModel } from '../model/summary';
import type { ArchitectureModel, ArchitectureNode, Position } from '../model/types';

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

const SVG_NODE_W = 200;
const SVG_NODE_H = 56;
const SVG_PAD = 48;

/**
 * Render the model as a standalone, dependency-free SVG: a vector snapshot of
 * the diagram suitable for embedding in docs or a PR. Uses stored positions
 * when present, otherwise the deterministic auto-layout, so it works whether or
 * not a layout sidecar exists. Theme is light so it reads on a white page.
 */
export function toSvg(model: ArchitectureModel): string {
  const positions = resolvePositions(model);
  const center = (id: string): Position => {
    const p = positions.get(id) ?? { x: 0, y: 0 };
    return { x: p.x + SVG_NODE_W / 2, y: p.y + SVG_NODE_H / 2 };
  };

  // Pre-compute the enclosing box for each non-empty group; its label sits above
  // the box, so it contributes to the drawing bounds too.
  const GROUP_PAD = 22;
  const GROUP_LABEL_H = 16;
  const groupName = new Map(model.groups.map((g) => [g.id, g.name]));
  const groupBoxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
  for (const group of model.groups) {
    const members = model.nodes.filter((n) => n.groupId === group.id);
    if (members.length === 0) continue;
    let gx = Infinity;
    let gy = Infinity;
    let gx2 = -Infinity;
    let gy2 = -Infinity;
    for (const node of members) {
      const p = positions.get(node.id) ?? { x: 0, y: 0 };
      gx = Math.min(gx, p.x);
      gy = Math.min(gy, p.y);
      gx2 = Math.max(gx2, p.x + SVG_NODE_W);
      gy2 = Math.max(gy2, p.y + SVG_NODE_H);
    }
    groupBoxes.push({
      name: groupName.get(group.id) ?? group.name,
      x: gx - GROUP_PAD,
      y: gy - GROUP_PAD - GROUP_LABEL_H,
      w: gx2 - gx + GROUP_PAD * 2,
      h: gy2 - gy + GROUP_PAD * 2 + GROUP_LABEL_H,
    });
  }

  // Drawing bounds span nodes and group boxes; the viewBox absorbs any overhang
  // (e.g. a context flush against the top edge) so nothing is clipped.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + SVG_NODE_W);
    maxY = Math.max(maxY, p.y + SVG_NODE_H);
  }
  for (const b of groupBoxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = SVG_NODE_W;
    maxY = SVG_NODE_H;
  }
  const ox = minX - SVG_PAD;
  const oy = minY - SVG_PAD;
  const width = maxX - minX + SVG_PAD * 2;
  const height = maxY - minY + SVG_PAD * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" ` +
      `viewBox="${round(ox)} ${round(oy)} ${round(width)} ${round(height)}" ` +
      `font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  parts.push(
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" ' +
      'markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>',
  );
  parts.push(`<rect x="${round(ox)}" y="${round(oy)}" width="${round(width)}" height="${round(height)}" fill="#ffffff"/>`);

  // Group regions behind everything.
  for (const b of groupBoxes) {
    parts.push(
      `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" ` +
        `rx="12" fill="#f1f5f9" stroke="#cbd5e1"/>`,
    );
    parts.push(
      `<text x="${round(b.x + 12)}" y="${round(b.y + GROUP_LABEL_H + 2)}" font-size="12" ` +
        `fill="#64748b" font-weight="600">${escapeXml(b.name)}</text>`,
    );
  }

  // Edges.
  for (const edge of model.edges) {
    if (!positions.has(edge.source) || !positions.has(edge.target)) continue;
    const a = center(edge.source);
    const b = center(edge.target);
    parts.push(
      `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}" ` +
        `stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
    const mx = round((a.x + b.x) / 2);
    const my = round((a.y + b.y) / 2);
    parts.push(
      `<text x="${mx}" y="${my - 4}" font-size="10" fill="#64748b" text-anchor="middle">` +
        `${escapeXml(getProtocolLabel(edge.protocol))}</text>`,
    );
  }

  // Nodes on top.
  for (const node of model.nodes) {
    const p = positions.get(node.id) ?? { x: 0, y: 0 };
    const def = getNodeTypeDefinition(node.type);
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${SVG_NODE_W}" height="${SVG_NODE_H}" rx="10" ` +
        `fill="#ffffff" stroke="${def.accent}" stroke-width="2"/>`,
    );
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="4" height="${SVG_NODE_H}" rx="2" fill="${def.accent}"/>`,
    );
    parts.push(
      `<text x="${p.x + 16}" y="${p.y + 23}" font-size="13" fill="#0f172a" font-weight="600">` +
        `${escapeXml(truncate(node.name, 24))}</text>`,
    );
    parts.push(
      `<text x="${p.x + 16}" y="${p.y + 41}" font-size="10.5" fill="#64748b">` +
        `${escapeXml(def.label)}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function resolvePositions(model: ArchitectureModel): Map<string, Position> {
  const hasStored = model.nodes.some((n) => n.position.x !== 0 || n.position.y !== 0);
  if (hasStored) {
    return new Map(model.nodes.map((n) => [n.id, n.position]));
  }
  return computeLayout(model.nodes, model.edges);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function round(n: number): number {
  return Math.round(n);
}
