/**
 * The Issues panel lists architecture-rule violations. Clicking a violation
 * selects the offending node or edge on the canvas, so the panel doubles as a
 * navigator for design problems.
 */

import type { RuleSeverity, RuleViolation } from '../../shared/rules/rules';

interface IssuesPanelProps {
  violations: RuleViolation[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}

const SEVERITY_LABEL: Record<RuleSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Suggestion',
};

export function IssuesPanel({
  violations,
  onSelectNode,
  onSelectEdge,
}: IssuesPanelProps): JSX.Element {
  if (violations.length === 0) {
    return (
      <div className="atlas-inspector__empty">
        <div className="atlas-inspector__empty-title">No issues</div>
        <p className="atlas-inspector__empty-body">
          Atlas didn’t find any architecture-rule violations in the current map.
        </p>
      </div>
    );
  }

  return (
    <div className="atlas-issues">
      {violations.map((violation, index) => (
        <button
          key={`${violation.ruleId}-${index}`}
          type="button"
          className="atlas-issue"
          onClick={() => {
            if (violation.nodeId) {
              onSelectNode(violation.nodeId);
            } else if (violation.edgeId) {
              onSelectEdge(violation.edgeId);
            }
          }}
        >
          <span className={`atlas-issue__dot atlas-issue__dot--${violation.severity}`} aria-hidden="true" />
          <span className="atlas-issue__body">
            <span className="atlas-issue__severity">{SEVERITY_LABEL[violation.severity]}</span>
            <span className="atlas-issue__message">{violation.message}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
