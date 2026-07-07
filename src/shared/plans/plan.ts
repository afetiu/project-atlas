/**
 * Plans — the propose → assess → decide → build workflow.
 *
 * A plan is a *proposed* architecture: a sandboxed target model with a name and
 * a rationale, saved under `atlas/plans/` so proposals are reviewable files,
 * not whiteboard photos. This module is the pure core: (de)serialization,
 * blast-radius analysis, the live assessment (what changes, what's affected,
 * how health moves), and the generated decision record (ADR) — the ADR becomes
 * exhaust from the act of deciding instead of homework afterwards.
 */

import { parse, stringify } from 'yaml';

import { diffModels, summarizeDelta, type ModelDelta } from '../model/diff';
import { analyzeArchitecture, type ArchitectureReport } from '../model/insights';
import type { ArchitectureModel } from '../model/types';
import { modelFromPlain, modelToPlain } from '../serialization/yaml';

export type PlanStatus = 'draft' | 'decided' | 'applied' | 'abandoned';

export interface Plan {
  name: string;
  rationale: string;
  status: PlanStatus;
  /** ISO timestamp of creation (informational). */
  createdAt: string;
  /** The proposed architecture. */
  target: ArchitectureModel;
}

export interface PlanSummary {
  file: string;
  name: string;
  status: PlanStatus;
  createdAt: string;
}

export function serializePlan(plan: Plan): string {
  return stringify(
    {
      name: plan.name,
      status: plan.status,
      createdAt: plan.createdAt,
      rationale: plan.rationale,
      target: modelToPlain(plan.target),
    },
    { indent: 2, lineWidth: 0 },
  );
}

export function deserializePlan(text: string): Plan {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  const status = raw.status;
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled plan',
    rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
    status:
      status === 'decided' || status === 'applied' || status === 'abandoned' ? status : 'draft',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    target: modelFromPlain(raw.target),
  };
}

export function planFileName(name: string): string {
  const slug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plan';
  return `${slug}.yaml`;
}

/* ------------------------------- assessment ------------------------------ */

export interface PlanAssessment {
  delta: ModelDelta;
  /** Human-readable change lines (from summarizeDelta). */
  changes: string[];
  /** Components directly touched by the plan (added / updated / rewired). */
  changedNodeIds: string[];
  /**
   * Blast radius: components *not* directly changed that transitively depend on
   * a changed one — the ripple a reviewer needs to see.
   */
  blastNodeIds: string[];
  before: ArchitectureReport;
  after: ArchitectureReport;
  /** Insight titles resolved by the plan and newly introduced by it. */
  resolvedInsights: string[];
  introducedInsights: string[];
}

export function assessPlan(base: ArchitectureModel, target: ArchitectureModel): PlanAssessment {
  const delta = diffModels(base, target);
  const changed = new Set<string>();
  for (const n of delta.addedNodes) changed.add(n.id);
  for (const n of delta.removedNodes) changed.add(n.id);
  for (const u of delta.updatedNodes) changed.add(u.after.id);
  for (const e of [...delta.addedEdges, ...delta.removedEdges]) {
    changed.add(e.source);
    changed.add(e.target);
  }
  for (const u of delta.updatedEdges) {
    changed.add(u.after.source);
    changed.add(u.after.target);
    changed.add(u.before.source);
    changed.add(u.before.target);
  }

  const blast = blastRadius(target, changed);
  const before = analyzeArchitecture(base);
  const after = analyzeArchitecture(target);

  const beforeTitles = new Set(before.insights.map((i) => insightKey(i.title, i.detail)));
  const afterTitles = new Set(after.insights.map((i) => insightKey(i.title, i.detail)));
  const resolvedInsights = before.insights
    .filter((i) => !afterTitles.has(insightKey(i.title, i.detail)))
    .map((i) => i.title);
  const introducedInsights = after.insights
    .filter((i) => !beforeTitles.has(insightKey(i.title, i.detail)))
    .map((i) => i.title);

  const targetIds = new Set(target.nodes.map((n) => n.id));
  return {
    delta,
    changes: summarizeDelta(delta),
    changedNodeIds: [...changed].filter((id) => targetIds.has(id)),
    blastNodeIds: [...blast],
    before,
    after,
    resolvedInsights,
    introducedInsights,
  };
}

function insightKey(title: string, detail: string): string {
  return `${title}::${detail}`;
}

/**
 * Everything that transitively *depends on* any of `changedIds` — i.e. walk the
 * dependency edges backwards. Changed components themselves are excluded; the
 * result is the ripple, not the stone.
 */
export function blastRadius(model: ArchitectureModel, changedIds: ReadonlySet<string>): Set<string> {
  const dependents = new Map<string, string[]>(); // target -> sources that depend on it
  for (const edge of model.edges) {
    (dependents.get(edge.target) ?? dependents.set(edge.target, []).get(edge.target)!).push(
      edge.source,
    );
  }
  const out = new Set<string>();
  const queue = [...changedIds];
  const seen = new Set(changedIds);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dep of dependents.get(current) ?? []) {
      if (seen.has(dep)) {
        continue;
      }
      seen.add(dep);
      out.add(dep);
      queue.push(dep);
    }
  }
  return out;
}

/* --------------------------------- ADR ----------------------------------- */

export interface AdrInput {
  number: number;
  plan: Plan;
  base: ArchitectureModel;
  assessment: PlanAssessment;
}

/** Render the plan's decision record as a conventional ADR document. */
export function renderAdr({ number, plan, base, assessment }: AdrInput): string {
  const id = String(number).padStart(3, '0');
  const name = (id2: string) => base.nodes.find((n) => n.id === id2)?.name ?? id2;
  const healthLine = `${assessment.before.grade} ${assessment.before.score}/100 → ${assessment.after.grade} ${assessment.after.score}/100`;

  const lines: string[] = [
    `# ADR-${id}: ${plan.name}`,
    '',
    `- Status: accepted`,
    ...(plan.createdAt ? [`- Date: ${plan.createdAt.slice(0, 10)}`] : []),
    '',
    '## Context',
    '',
    `The architecture at decision time had ${base.nodes.length} components across ${base.groups.length} bounded context${base.groups.length === 1 ? '' : 's'} (health ${assessment.before.grade} ${assessment.before.score}/100).`,
    '',
    '## Decision',
    '',
    ...(plan.rationale.trim() ? [plan.rationale.trim(), ''] : []),
    ...assessment.changes.map((c) => `- ${c}`),
    '',
    '## Consequences',
    '',
    `- Architecture health: ${healthLine}`,
  ];

  if (assessment.blastNodeIds.length > 0) {
    lines.push(
      `- Blast radius: ${assessment.blastNodeIds.length} dependent component${assessment.blastNodeIds.length === 1 ? '' : 's'} affected — ${assessment.blastNodeIds.map(name).join(', ')}.`,
    );
  } else {
    lines.push('- Blast radius: no dependent components affected.');
  }
  for (const title of assessment.resolvedInsights) {
    lines.push(`- Resolves: ${title}.`);
  }
  for (const title of assessment.introducedInsights) {
    lines.push(`- Introduces: ${title} (accepted trade-off).`);
  }
  lines.push('', '---', '', `_Generated by Atlas from plan "${plan.name}"._`);
  return lines.join('\n');
}
