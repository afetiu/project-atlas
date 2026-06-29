/**
 * Top-bar AI actions: detect from code, apply pending architecture changes, and
 * a busy/cancel indicator. Kept presentational — all behaviour is delegated to
 * callbacks supplied by the App.
 */

import type { AiStatus } from '../model/useAiSession';

interface ToolbarProps {
  status: AiStatus;
  pendingCount: number;
  onDetect: () => void;
  onApplyPending: () => void;
  onCancel: () => void;
}

export function Toolbar({
  status,
  pendingCount,
  onDetect,
  onApplyPending,
  onCancel,
}: ToolbarProps): JSX.Element {
  return (
    <div className="atlas-toolbar">
      {status.busy ? (
        <div className="atlas-toolbar__busy">
          <span className="atlas-activity__spinner" aria-hidden="true" />
          <span className="atlas-toolbar__busy-label">{status.label ?? 'Working…'}</span>
          <button type="button" className="atlas-button atlas-button--small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          {pendingCount > 0 && (
            <button
              type="button"
              className="atlas-button atlas-button--accent atlas-button--small"
              onClick={onApplyPending}
              title="Generate code for the pending architecture changes"
            >
              Apply {pendingCount} change{pendingCount === 1 ? '' : 's'}
            </button>
          )}
          <button
            type="button"
            className="atlas-button atlas-button--small"
            onClick={onDetect}
            title="Analyze the repository and generate the architecture map"
          >
            Detect from code
          </button>
        </>
      )}
    </div>
  );
}
