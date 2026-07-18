/**
 * The Health panel — ONE place for "what's wrong (and right) with my
 * architecture". It leads with the health grade and key metrics, then lists
 * every finding in severity order regardless of what produced it: custom
 * rule violations and the structural analyzer's insights are the same kind of
 * thing to the person reading them. Clicking a finding flies to the culprit.
 */

import { useMemo } from 'react';

import {
  sortInsights,
  type ArchitectureReport,
  type InsightSeverity,
} from '../../shared/model/insights';
import type { ArchitectureModel } from '../../shared/model/types';
import type { RuleSeverity, RuleViolation } from '../../shared/rules/rules';

interface HealthPanelProps {
  model: ArchitectureModel;
  /** Computed once in App (it also feeds the tab badge). */
  report: ArchitectureReport;
  violations: RuleViolation[];
  onFocusNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

interface Finding {
  key: string;
  severity: RuleSeverity;
  heading: string;
  message: string;
  onClick?: () => void;
}

const SEVERITY_LABEL: Record<RuleSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Suggestion',
};

const SEVERITY_RANK: Record<RuleSeverity, number> = { error: 0, warning: 1, info: 2 };

function toRuleSeverity(severity: InsightSeverity): RuleSeverity {
  return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';
}

export function HealthPanel({
  model,
  report,
  violations,
  onFocusNode,
  onSelectEdge,
}: HealthPanelProps): JSX.Element {
  const findings = useMemo<Finding[]>(() => {
    const fromInsights: Finding[] = sortInsights(report.insights).map((insight) => ({
      key: `insight-${insight.id}`,
      severity: toRuleSeverity(insight.severity),
      heading: `${SEVERITY_LABEL[toRuleSeverity(insight.severity)]} · ${insight.title}`,
      message: insight.detail,
      onClick: insight.nodeIds[0] ? () => onFocusNode(insight.nodeIds[0]) : undefined,
    }));
    const fromRules: Finding[] = violations.map((violation, index) => ({
      key: `rule-${violation.ruleId}-${index}`,
      severity: violation.severity,
      heading: SEVERITY_LABEL[violation.severity],
      message: violation.message,
      onClick: violation.nodeId
        ? () => onFocusNode(violation.nodeId as string)
        : violation.edgeId
          ? () => onSelectEdge(violation.edgeId as string)
          : undefined,
    }));
    return [...fromRules, ...fromInsights].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
  }, [report.insights, violations, onFocusNode, onSelectEdge]);

  if (model.nodes.length === 0) {
    return (
      <div className="atlas-inspector__empty">
        <div className="atlas-inspector__empty-title">No architecture yet</div>
        <p className="atlas-inspector__empty-body">
          Map a repository or add components to see health insights.
        </p>
      </div>
    );
  }

  const { metrics } = report;
  const nameOf = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  const stable = pickByInstability(report, 'min');
  const volatile = pickByInstability(report, 'max');

  return (
    <div className="atlas-insights">
      <div className="atlas-health">
        <div className={`atlas-health__grade atlas-health__grade--${report.grade.toLowerCase()}`}>
          {report.grade}
        </div>
        <div className="atlas-health__meta">
          <div className="atlas-health__score">{report.score}/100</div>
          <div className="atlas-health__label">Architecture health</div>
        </div>
      </div>

      <div className="atlas-metrics">
        <Metric label="Components" value={String(metrics.nodeCount)} />
        <Metric label="Connections" value={String(metrics.edgeCount)} />
        <Metric label="Mapped" value={`${Math.round(metrics.mappingCoverage * 100)}%`} />
        <Metric label="Isolated" value={String(metrics.isolatedCount)} />
      </div>

      {(stable || volatile) && (
        <div className="atlas-insights__couplers">
          {stable && (
            <button type="button" className="atlas-coupler" onClick={() => onFocusNode(stable.id)}>
              <span className="atlas-coupler__tag">Most stable</span>
              <span className="atlas-coupler__name">{nameOf(stable.id)}</span>
            </button>
          )}
          {volatile && volatile.id !== stable?.id && (
            <button type="button" className="atlas-coupler" onClick={() => onFocusNode(volatile.id)}>
              <span className="atlas-coupler__tag">Most volatile</span>
              <span className="atlas-coupler__name">{nameOf(volatile.id)}</span>
            </button>
          )}
        </div>
      )}

      <div className="atlas-insights__findings">
        {findings.length === 0 ? (
          <div className="atlas-insights__clean">✓ No findings — rules pass, structure is clean.</div>
        ) : (
          findings.map((finding) => (
            <button
              key={finding.key}
              type="button"
              className="atlas-issue"
              onClick={finding.onClick}
            >
              <span
                className={`atlas-issue__dot atlas-issue__dot--${finding.severity}`}
                aria-hidden="true"
              />
              <span className="atlas-issue__body">
                <span className="atlas-issue__severity">{finding.heading}</span>
                <span className="atlas-issue__message">{finding.message}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="atlas-metric">
      <div className="atlas-metric__value">{value}</div>
      <div className="atlas-metric__label">{label}</div>
    </div>
  );
}

function pickByInstability(
  report: ArchitectureReport,
  dir: 'min' | 'max',
): { id: string } | null {
  let best: { id: string; instability: number } | null = null;
  for (const m of report.metrics.byNode.values()) {
    if (m.instability === undefined) continue;
    if (
      !best ||
      (dir === 'min' && m.instability < best.instability) ||
      (dir === 'max' && m.instability > best.instability)
    ) {
      best = { id: m.id, instability: m.instability };
    }
  }
  return best ? { id: best.id } : null;
}
