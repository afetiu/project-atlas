/**
 * Top-bar actions: map the repository, apply pending architecture changes, and
 * a busy/cancel indicator. Kept presentational — all behaviour is delegated to
 * callbacks supplied by the App.
 *
 * There is ONE verb for getting a map — "Map from code" (instant, static).
 * AI enrichment lives behind ⌘K ("Detect with AI") and the empty state, so
 * two near-synonymous buttons never compete for the same intent.
 */

import type { AiStatus } from '../model/useAiSession';

interface ToolbarProps {
  status: AiStatus;
  pendingCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onMapFromCode: () => void;
  onApplyPending: () => void;
  onCancel: () => void;
}

export function Toolbar({
  status,
  pendingCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMapFromCode,
  onApplyPending,
  onCancel,
}: ToolbarProps): JSX.Element {
  return (
    <div className="atlas-toolbar">
      {!status.busy && (
        <div className="atlas-toolbar__history">
          <button
            type="button"
            className="atlas-button atlas-button--small"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="atlas-button atlas-button--small"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            ↷
          </button>
        </div>
      )}
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
            onClick={onMapFromCode}
            title="Derive the map from the code's imports — instant, no AI. For AI enrichment, run “Detect with AI” from ⌘K."
          >
            Map from code
          </button>
        </>
      )}
    </div>
  );
}
