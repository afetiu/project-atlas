/**
 * User-authored architecture rules, loaded from `atlas.rules.yaml`.
 *
 * Rules are declarative (not code), so they're safe to load and to share across
 * a team, and they run identically in the extension, the webview, and the
 * `atlas check` CLI. Each entry compiles to an {@link ArchitectureRule}.
 *
 * Example `atlas.rules.yaml`:
 *   rules:
 *     - id: no-frontend-db
 *       severity: error
 *       forbidEdge: { fromType: frontend, toType: [database, cache] }
 *     - id: services-need-code
 *       severity: warning
 *       requireField: mapping
 *     - id: no-cross-context-db
 *       severity: error
 *       forbidCrossContextEdge: { toType: database }
 */

import { parse } from 'yaml';

import { getNodeTypeDefinition } from '../model/nodeTypes';
import type { ArchitectureModel } from '../model/types';
import type { ArchitectureRule, RuleSeverity, RuleViolation } from './rules';

interface RuleConfig {
  id?: string;
  severity?: RuleSeverity;
  title?: string;
  forbidEdge?: { fromType?: string | string[]; toType?: string | string[] };
  forbidCrossContextEdge?: { toType?: string | string[] };
  requireField?: 'description' | 'mapping';
}

export function compileRules(text: string): ArchitectureRule[] {
  let parsed: { rules?: RuleConfig[] } | null;
  try {
    parsed = parse(text) as { rules?: RuleConfig[] } | null;
  } catch {
    return [];
  }
  const configs = Array.isArray(parsed?.rules) ? parsed!.rules : [];
  return configs
    .filter((cfg): cfg is RuleConfig & { id: string } => typeof cfg?.id === 'string')
    .map(compileOne);
}

function compileOne(cfg: RuleConfig & { id: string }): ArchitectureRule {
  const severity: RuleSeverity = cfg.severity ?? 'warning';
  return {
    id: cfg.id,
    title: cfg.title ?? cfg.id,
    severity,
    evaluate: (model) => evaluate(cfg, severity, model),
  };
}

function evaluate(cfg: RuleConfig, severity: RuleSeverity, model: ArchitectureModel): RuleViolation[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const out: RuleViolation[] = [];

  if (cfg.forbidEdge) {
    const from = toSet(cfg.forbidEdge.fromType);
    const to = toSet(cfg.forbidEdge.toType);
    for (const edge of model.edges) {
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      if (s && t && matches(from, s.type) && matches(to, t.type)) {
        out.push({
          ruleId: cfg.id!,
          severity,
          message: `${label(s.type)} “${s.name}” must not connect to ${label(t.type)} “${t.name}”.`,
          edgeId: edge.id,
          nodeId: s.id,
        });
      }
    }
  }

  if (cfg.forbidCrossContextEdge) {
    const to = toSet(cfg.forbidCrossContextEdge.toType);
    for (const edge of model.edges) {
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      if (s && t && s.groupId && t.groupId && s.groupId !== t.groupId && matches(to, t.type)) {
        out.push({
          ruleId: cfg.id!,
          severity,
          message: `“${s.name}” crosses bounded contexts to reach ${label(t.type)} “${t.name}”.`,
          edgeId: edge.id,
          nodeId: s.id,
        });
      }
    }
  }

  if (cfg.requireField) {
    for (const node of model.nodes) {
      const missing =
        cfg.requireField === 'description' ? !node.description.trim() : !node.mapping?.path;
      if (missing) {
        out.push({
          ruleId: cfg.id!,
          severity,
          message: `“${node.name}” is missing required ${cfg.requireField}.`,
          nodeId: node.id,
        });
      }
    }
  }

  return out;
}

function toSet(value: string | string[] | undefined): Set<string> | null {
  if (value === undefined) return null;
  return new Set(Array.isArray(value) ? value : [value]);
}

function matches(set: Set<string> | null, type: string): boolean {
  return set === null || set.has(type);
}

function label(type: ArchitectureModel['nodes'][number]['type']): string {
  return getNodeTypeDefinition(type).label;
}
