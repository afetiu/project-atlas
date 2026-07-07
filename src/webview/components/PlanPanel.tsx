/**
 * The Plan panel — the assessment half of plan mode. While the canvas holds the
 * proposal (a sandboxed target model), this panel holds the judgement: what
 * changes, what the change ripples into (blast radius), how architecture health
 * moves, and which findings the plan resolves or introduces. From here the plan
 * becomes a decision record (ADR) or a build.
 */

import type { Plan, PlanAssessment } from '../../shared/plans/plan';

interface PlanPanelProps {
  file: string;
  plan: Plan;
  /** Live assessment against the real model; null until the baseline is known. */
  assessment: PlanAssessment | null;
  /** Workspace-relative path of the generated ADR, once one exists. */
  adrPath: string | null;
  nameOf: (nodeId: string) => string;
  onRename: (name: string) => void;
  onRationale: (text: string) => void;
  onGenerateAdr: () => void;
  onBuild: () => void;
  onFocusNode: (id: string) => void;
  onOpenFile: (path: string) => void;
}

const STATUS_LABEL: Record<Plan['status'], string> = {
  draft: 'Draft',
  decided: 'Decided',
  applied: 'Applied',
  abandoned: 'Abandoned',
};

export function PlanPanel({
  file,
  plan,
  assessment,
  adrPath,
  nameOf,
  onRename,
  onRationale,
  onGenerateAdr,
  onBuild,
  onFocusNode,
  onOpenFile,
}: PlanPanelProps): JSX.Element {
  const hasChanges = (assessment?.changes.length ?? 0) > 0;

  return (
    <div className="atlas-inspector">
      <div className="atlas-inspector__content atlas-plan">
      <div className="atlas-inspector__header">
        <div className="atlas-inspector__title">
          Plan
          <span className={`atlas-plan__status atlas-plan__status--${plan.status}`}>
            {STATUS_LABEL[plan.status]}
          </span>
        </div>
        <div className="atlas-inspector__subtitle">atlas/plans/{file}</div>
      </div>

      <label className="atlas-field">
        <span className="atlas-field__label">Name</span>
        <input
          className="atlas-input"
          value={plan.name}
          onChange={(event) => onRename(event.target.value)}
          placeholder="What are you proposing?"
        />
      </label>

      <label className="atlas-field">
        <span className="atlas-field__label">Rationale</span>
        <textarea
          className="atlas-input atlas-plan__rationale"
          value={plan.rationale}
          onChange={(event) => onRationale(event.target.value)}
          rows={3}
          placeholder="Why this change? This becomes the ADR's Decision section."
        />
      </label>

      {!hasChanges && (
        <div className="atlas-plan__hint">
          Sketch the proposal on the map — add, rewire, or regroup components. The
          assessment appears here as you go. atlas.yaml stays untouched.
        </div>
      )}

      {assessment && hasChanges && (
        <>
          <HealthDelta assessment={assessment} />

          <section className="atlas-plan__section">
            <div className="atlas-field__label">Changes ({assessment.changes.length})</div>
            <ul className="atlas-plan__changes">
              {assessment.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </section>

          <section className="atlas-plan__section">
            <div className="atlas-field__label">
              Blast radius ({assessment.blastNodeIds.length})
            </div>
            {assessment.blastNodeIds.length === 0 ? (
              <div className="atlas-plan__quiet">No dependent components affected.</div>
            ) : (
              <div className="atlas-plan__chips">
                {assessment.blastNodeIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="atlas-plan__chip"
                    onClick={() => onFocusNode(id)}
                    title="Depends on something this plan changes"
                  >
                    {nameOf(id)}
                  </button>
                ))}
              </div>
            )}
          </section>

          {(assessment.resolvedInsights.length > 0 || assessment.introducedInsights.length > 0) && (
            <section className="atlas-plan__section">
              <div className="atlas-field__label">Findings</div>
              <ul className="atlas-plan__findings">
                {assessment.resolvedInsights.map((title) => (
                  <li key={`r-${title}`} className="atlas-plan__finding atlas-plan__finding--resolves">
                    Resolves: {title}
                  </li>
                ))}
                {assessment.introducedInsights.map((title) => (
                  <li key={`i-${title}`} className="atlas-plan__finding atlas-plan__finding--introduces">
                    Introduces: {title}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="atlas-plan__actions">
        <button
          type="button"
          className="atlas-button"
          onClick={onGenerateAdr}
          disabled={!hasChanges}
          title="Write the decision record into docs/adr/ and mark this plan decided"
        >
          Generate ADR
        </button>
        <button
          type="button"
          className="atlas-button atlas-button--accent"
          onClick={onBuild}
          disabled={!hasChanges}
          title="Apply this plan: persist the target architecture and generate the code changes"
        >
          Build it
        </button>
      </div>

      {adrPath && (
        <button
          type="button"
          className="atlas-plan__adr"
          onClick={() => onOpenFile(adrPath)}
          title="Open the decision record"
        >
          ✓ Decision record written — {adrPath}
        </button>
      )}
      </div>
    </div>
  );
}

function HealthDelta({ assessment }: { assessment: PlanAssessment }): JSX.Element {
  const { before, after } = assessment;
  const direction = after.score > before.score ? 'up' : after.score < before.score ? 'down' : 'flat';
  return (
    <div className={`atlas-plan__health atlas-plan__health--${direction}`}>
      <span className="atlas-plan__health-label">Health</span>
      <span className="atlas-plan__health-value">
        {before.grade} {before.score}
        <span className="atlas-plan__health-arrow" aria-hidden="true">
          {' '}
          →{' '}
        </span>
        {after.grade} {after.score}
      </span>
      <span className="atlas-plan__health-note">
        {direction === 'up' ? 'improves' : direction === 'down' ? 'degrades' : 'unchanged'}
      </span>
    </div>
  );
}
