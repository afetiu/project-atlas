/**
 * Architecture intelligence: turns the raw graph and its metrics into a small
 * set of high-signal, human-readable findings plus an overall health score.
 *
 * This is what makes Atlas a *thinking* tool rather than a drawing tool — it
 * answers "is this a healthy architecture, and where are the risks?" Pure and
 * shared, so the webview Insights view and the `atlas check` CLI report the
 * exact same thing.
 */

import { computeMetrics, detectContextCycles, detectCycles, type ModelMetrics } from './metrics';
import type { NodeTypeId } from './nodeTypes';
import type { ArchitectureModel } from './types';

export type InsightSeverity = 'critical' | 'warning' | 'info';
export type InsightKind =
  | 'dependency-cycle'
  | 'context-cycle'
  | 'over-coupled'
  | 'layering-violation'
  | 'low-mapping-coverage';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Components implicated, for focus/highlight in the UI. */
  nodeIds: string[];
  /** A single offending edge, when the finding is about one connection. */
  edgeId?: string;
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ArchitectureReport {
  /** 0–100 composite health score. */
  score: number;
  grade: HealthGrade;
  metrics: ModelMetrics;
  insights: Insight[];
}

/**
 * Conventional dependency tiers. A healthy dependency flows downward
 * (frontend → service → datastore); an edge that flows *upward* (a datastore
 * calling a service, say) is a layering violation.
 */
const TIER: Record<NodeTypeId, number> = {
  frontend: 0,
  service: 1,
  queue: 1,
  externalApi: 1,
  cache: 2,
  database: 2,
};

/** Fan-out at or above this means a component depends on too much. */
const OVER_COUPLED_FANOUT = 6;

export function analyzeArchitecture(model: ArchitectureModel): ArchitectureReport {
  const metrics = computeMetrics(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const insights: Insight[] = [];

  // 1. Dependency cycles between components — the highest-severity structural smell.
  for (const cycle of detectCycles(model)) {
    const isSelf = cycle.length === 1;
    insights.push({
      id: `dependency-cycle:${cycle.join('>')}`,
      kind: 'dependency-cycle',
      severity: 'critical',
      title: isSelf ? 'Component depends on itself' : 'Dependency cycle',
      detail: isSelf
        ? `"${name(cycle[0])}" has a self-dependency.`
        : `${cycle.map(name).map((n) => `"${n}"`).join(' → ')} → "${name(cycle[0])}" form a cycle; changes ripple in a loop.`,
      nodeIds: cycle,
    });
  }

  // 2. Cycles between bounded contexts — domain-level coupling.
  for (const cycle of detectContextCycles(model)) {
    const groupName = new Map(model.groups.map((g) => [g.id, g.name]));
    insights.push({
      id: `context-cycle:${cycle.join('>')}`,
      kind: 'context-cycle',
      severity: 'warning',
      title: 'Bounded contexts depend on each other',
      detail: `${cycle.map((g) => `"${groupName.get(g) ?? g}"`).join(' ↔ ')} are mutually dependent.`,
      nodeIds: model.nodes.filter((n) => n.groupId && cycle.includes(n.groupId)).map((n) => n.id),
    });
  }

  // 3. Over-coupled "god" components.
  for (const m of metrics.byNode.values()) {
    if (m.fanOut >= OVER_COUPLED_FANOUT) {
      insights.push({
        id: `over-coupled:${m.id}`,
        kind: 'over-coupled',
        severity: 'warning',
        title: 'Over-coupled component',
        detail: `"${name(m.id)}" depends on ${m.fanOut} other components — consider splitting its responsibilities.`,
        nodeIds: [m.id],
      });
    }
  }

  // 4. Layering violations: an edge flowing "upward" against the tier order.
  for (const edge of model.edges) {
    const s = byId.get(edge.source);
    const t = byId.get(edge.target);
    if (!s || !t || s.id === t.id) {
      continue;
    }
    if (TIER[s.type] > TIER[t.type]) {
      insights.push({
        id: `layering-violation:${edge.id}`,
        kind: 'layering-violation',
        severity: 'warning',
        title: 'Layering violation',
        detail: `"${s.name}" (${s.type}) depends on "${t.name}" (${t.type}), which sits at a higher layer.`,
        nodeIds: [s.id, t.id],
        edgeId: edge.id,
      });
    }
  }

  // 5. Low code-mapping coverage caps how much Atlas can generate.
  if (metrics.nodeCount > 0 && metrics.mappingCoverage < 0.5) {
    insights.push({
      id: 'low-mapping-coverage',
      kind: 'low-mapping-coverage',
      severity: 'info',
      title: 'Low code-mapping coverage',
      detail: `Only ${Math.round(metrics.mappingCoverage * 100)}% of components map to code, limiting code generation and drift detection.`,
      nodeIds: [],
    });
  }

  const score = scoreFromInsights(insights, metrics);
  return { score, grade: gradeFor(score), metrics, insights };
}

/** Composite 0–100 score: start at 100 and deduct weighted penalties. */
function scoreFromInsights(insights: Insight[], metrics: ModelMetrics): number {
  if (metrics.nodeCount === 0) {
    return 100;
  }
  const WEIGHT: Record<InsightKind, number> = {
    'dependency-cycle': 15,
    'context-cycle': 8,
    'over-coupled': 6,
    'layering-violation': 5,
    'low-mapping-coverage': 6,
  };
  let penalty = 0;
  for (const i of insights) {
    penalty += WEIGHT[i.kind];
  }
  // Isolated components are a mild smell that no insight emits on its own.
  penalty += Math.min(metrics.isolatedCount * 3, 12);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function gradeFor(score: number): HealthGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  return 'F';
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Sort insights most-severe first, for display. */
export function sortInsights(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
