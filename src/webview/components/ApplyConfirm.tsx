/**
 * Confirmation shown before code generation runs. It lists the architecture
 * changes that will be realized so the user explicitly approves writing code to
 * their repo — codegen is never triggered without this step.
 */

import { useRef } from 'react';

import { useOverlay } from '../hooks/useOverlay';

interface ApplyConfirmProps {
  changes: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApplyConfirm({ changes, onConfirm, onCancel }: ApplyConfirmProps): JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);
  useOverlay(modalRef, onCancel);

  return (
    <div className="atlas-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="atlas-modal atlas-modal--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm code generation"
        tabIndex={-1}
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="atlas-modal__header">
          <div>
            <div className="atlas-modal__title">Generate code for these changes?</div>
            <div className="atlas-modal__subtitle">
              Atlas will modify files in your workspace. You can review the diff and revert after.
            </div>
          </div>
        </header>
        <div className="atlas-modal__body">
          {changes.length === 0 ? (
            <div className="atlas-modal__empty">No code-relevant changes.</div>
          ) : (
            <ul className="atlas-change-list">
              {changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          )}
        </div>
        <footer className="atlas-modal__footer">
          <button type="button" className="atlas-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="atlas-button atlas-button--accent" onClick={onConfirm}>
            Generate code
          </button>
        </footer>
      </div>
    </div>
  );
}
