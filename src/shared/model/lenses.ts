/**
 * Map "lenses" — the SimCity-style data overlays for the architecture map.
 *
 * The same topology can be read through different lenses: structural risk,
 * drift, code coverage, coupling/traffic. Each lens is a pure function of the
 * model (plus a little host-supplied context like which nodes have drifted)
 * that returns a semantic tone per node/edge. The webview maps tones to colours,
 * so the information design lives here and stays testable.
 */

import { analyzeArchitecture } from './insights';
import { computeMetrics } from './metrics';
import type { ArchitectureModel } from './types';

export type MapLens = 'structure' | 'risk' | 'drift' | 'coverage' | 'coupling' | 'live';

/** Semantic overlay tones; the webview resolves these to colours. */
export type OverlayTone = 'danger' | 'warn' | 'ok' | 'info' | 'muted' | 'hot';

export interface LensOverlay {
  nodeTone: Map<string, OverlayTone>;
  edgeTone: Map<string, OverlayTone>;
  /** Road "traffic" weight per edge, 1–3, for the coupling lens. */
  edgeWeight: Map<string, number>;
}

export interface LensContext {
  driftedNodeIds?: Iterable<string>;
}

export const LENSES: Array<{ id: MapLens; label: string; hint: string }> = [
  { id: 'structure', label: 'Structure', hint: 'The plain map' },
  { id: 'risk', label: 'Risk', hint: 'Cycles, coupling & layering smells' },
  { id: 'drift', label: 'Drift', hint: 'Changed in code since last detection' },
  { id: 'coverage', label: 'Coverage', hint: 'Mapped to code vs pure intent' },
  { id: 'coupling', label: 'Traffic', hint: 'Busiest components & routes' },
  { id: 'live', label: 'Live', hint: 'Bound to a real, operable service vs pure intent' },
];

function empty(): LensOverlay {
  return { nodeTone: new Map(), edgeTone: new Map(), edgeWeight: new Map() };
}

export function computeLens(
  model: ArchitectureModel,
  lens: MapLens,
  context: LensContext = {},
): LensOverlay {
  switch (lens) {
    case 'structure':
      return empty();
    case 'risk':
      return riskLens(model);
    case 'drift':
      return driftLens(model, context);
    case 'coverage':
      return coverageLens(model);
    case 'coupling':
      return couplingLens(model);
    case 'live':
      return liveLens(model);
  }
}

function liveLens(model: ArchitectureModel): LensOverlay {
  const out = empty();
  for (const node of model.nodes) {
    out.nodeTone.set(node.id, node.binding?.server ? 'ok' : 'muted');
  }
  return out;
}

function riskLens(model: ArchitectureModel): LensOverlay {
  const out = empty();
  const report = analyzeArchitecture(model);
  for (const insight of report.insights) {
    const tone: OverlayTone = insight.severity === 'critical' ? 'danger' : insight.severity === 'warning' ? 'warn' : 'info';
    for (const id of insight.nodeIds) {
      // Keep the worst tone if a node is implicated by several findings.
      if (rank(tone) < rank(out.nodeTone.get(id))) {
        out.nodeTone.set(id, tone);
      }
    }
    if (insight.edgeId) {
      out.edgeTone.set(insight.edgeId, tone);
    }
  }
  return out;
}

function driftLens(model: ArchitectureModel, context: LensContext): LensOverlay {
  const out = empty();
  const drifted = new Set(context.driftedNodeIds ?? []);
  for (const node of model.nodes) {
    out.nodeTone.set(node.id, drifted.has(node.id) ? 'warn' : 'muted');
  }
  return out;
}

function coverageLens(model: ArchitectureModel): LensOverlay {
  const out = empty();
  for (const node of model.nodes) {
    if (node.type === 'externalApi') {
      out.nodeTone.set(node.id, 'muted'); // not code-mappable; neither good nor bad
    } else {
      out.nodeTone.set(node.id, node.mapping?.path ? 'ok' : 'warn');
    }
  }
  return out;
}

function couplingLens(model: ArchitectureModel): LensOverlay {
  const out = empty();
  const metrics = computeMetrics(model);
  const degrees = [...metrics.byNode.values()].map((m) => m.degree);
  const maxDegree = Math.max(1, ...degrees);
  for (const m of metrics.byNode.values()) {
    // The busiest hubs glow hot; quiet leaves recede.
    out.nodeTone.set(m.id, m.degree >= maxDegree * 0.66 && m.degree > 1 ? 'hot' : 'muted');
  }
  const deg = (id: string) => metrics.byNode.get(id)?.degree ?? 0;
  const maxTraffic = Math.max(1, ...model.edges.map((e) => deg(e.source) + deg(e.target)));
  for (const edge of model.edges) {
    const traffic = (deg(edge.source) + deg(edge.target)) / maxTraffic;
    out.edgeWeight.set(edge.id, 1 + Math.round(traffic * 2)); // 1..3
    if (traffic >= 0.66) {
      out.edgeTone.set(edge.id, 'hot');
    }
  }
  return out;
}

const TONE_RANK: Record<OverlayTone, number> = {
  danger: 0,
  warn: 1,
  hot: 1,
  info: 2,
  ok: 3,
  muted: 4,
};

function rank(tone: OverlayTone | undefined): number {
  return tone === undefined ? Number.POSITIVE_INFINITY : TONE_RANK[tone];
}
