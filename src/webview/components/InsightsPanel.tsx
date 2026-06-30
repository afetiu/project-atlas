/**
 * The Insights panel: Atlas's architecture-intelligence view. Shows a health
 * grade, key coupling metrics, and a ranked list of structural findings
 * (cycles, layering violations, over-coupled components). Clicking a finding
 * focuses the implicated component on the canvas.
 */

import { useMemo } from 'react';

import { analyzeArchitecture, sortInsights, type InsightSeverity } from '../../shared/model/insights';
import type { ArchitectureModel } from '../../shared/model/types';

interface InsightsPanelProps {
  model: ArchitectureModel;
  onFocusNode: (id: string) => void;
}

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

export function InsightsPanel({ model, onFocusNode }: InsightsPanelProps): JSX.Element {
  const report = useMemo(() => analyzeArchitecture(model), [model]);
  const insights = useMemo(() => sortInsights(report.insights), [report.insights]);

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
        {insights.length === 0 ? (
          <div className="atlas-insights__clean">✓ No structural risks found.</div>
        ) : (
          insights.map((insight) => (
            <button
              key={insight.id}
              type="button"
              className="atlas-issue"
              onClick={() => insight.nodeIds[0] && onFocusNode(insight.nodeIds[0])}
            >
              <span
                className={`atlas-issue__dot atlas-issue__dot--${dotClass(insight.severity)}`}
                aria-hidden="true"
              />
              <span className="atlas-issue__body">
                <span className="atlas-issue__severity">
                  {SEVERITY_LABEL[insight.severity]} · {insight.title}
                </span>
                <span className="atlas-issue__message">{insight.detail}</span>
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

function dotClass(severity: InsightSeverity): string {
  return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';
}

function pickByInstability(
  report: ReturnType<typeof analyzeArchitecture>,
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
