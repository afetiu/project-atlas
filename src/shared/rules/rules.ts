/**
 * Architecture rules: lightweight, pure checks over the model that surface
 * design smells and gaps (a frontend reaching straight into a database, a
 * component with no code mapping, an orphaned node, …).
 *
 * Rules are deliberately data-driven and registry-based: add a rule to
 * `BUILT_IN_RULES` and the whole UI (the Issues panel, node badges) picks it up.
 * Each rule is a pure function of the model, so they are trivially testable and
 * reusable anywhere — webview, host, or a future CI check.
 */

import { getNodeTypeDefinition } from '../model/nodeTypes';
import type { ArchitectureModel } from '../model/types';

export type RuleSeverity = 'error' | 'warning' | 'info';

export interface RuleViolation {
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  /** The node this violation attaches to, when applicable. */
  nodeId?: string;
  /** The edge this violation attaches to, when applicable. */
  edgeId?: string;
}

export interface ArchitectureRule {
  id: string;
  title: string;
  severity: RuleSeverity;
  evaluate(model: ArchitectureModel): RuleViolation[];
}

/** A frontend should go through a service, not reach a datastore directly. */
const frontendDirectToData: ArchitectureRule = {
  id: 'frontend-direct-data',
  title: 'Frontend reaches a datastore directly',
  severity: 'warning',
  evaluate(model) {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    const violations: RuleViolation[] = [];
    for (const edge of model.edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source?.type === 'frontend' && (target?.type === 'database' || target?.type === 'cache')) {
        violations.push({
          ruleId: frontendDirectToData.id,
          severity: 'warning',
          message: `"${source.name}" (frontend) connects directly to ${getNodeTypeDefinition(target.type).label.toLowerCase()} "${target.name}".`,
          edgeId: edge.id,
          nodeId: source.id,
        });
      }
    }
    return violations;
  },
};

/** Components without a code mapping can't drive code generation. */
const missingMapping: ArchitectureRule = {
  id: 'missing-mapping',
  title: 'Component has no code mapping',
  severity: 'info',
  evaluate(model) {
    return model.nodes
      .filter((node) => node.type !== 'externalApi' && !node.mapping?.path)
      .map((node) => ({
        ruleId: missingMapping.id,
        severity: 'info' as const,
        message: `"${node.name}" has no code mapping, so it can't be code-generated yet.`,
        nodeId: node.id,
      }));
  },
};

/** A disconnected component is usually a modelling mistake. */
const orphanedNode: ArchitectureRule = {
  id: 'orphaned-node',
  title: 'Component has no connections',
  severity: 'info',
  evaluate(model) {
    if (model.nodes.length < 2) {
      return [];
    }
    const connected = new Set<string>();
    for (const edge of model.edges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    return model.nodes
      .filter((node) => !connected.has(node.id))
      .map((node) => ({
        ruleId: orphanedNode.id,
        severity: 'info' as const,
        message: `"${node.name}" is not connected to anything.`,
        nodeId: node.id,
      }));
  },
};

export const BUILT_IN_RULES: ArchitectureRule[] = [
  frontendDirectToData,
  missingMapping,
  orphanedNode,
];

export function evaluateRules(
  model: ArchitectureModel,
  rules: ArchitectureRule[] = BUILT_IN_RULES,
): RuleViolation[] {
  return rules.flatMap((rule) => rule.evaluate(model));
}

const SEVERITY_RANK: Record<RuleSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Highest severity among a set of violations, for badge colouring. */
export function topSeverity(violations: RuleViolation[]): RuleSeverity | undefined {
  return violations
    .map((v) => v.severity)
    .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
}
