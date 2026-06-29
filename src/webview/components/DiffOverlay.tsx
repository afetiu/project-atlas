/**
 * Modal overlay that shows the git diff produced by code generation, so the
 * user can review exactly what changed before keeping or reverting it (revert
 * happens through normal VS Code source control — Atlas only surfaces the diff).
 */

import type { ApplyResult } from '../model/useAiSession';

interface DiffOverlayProps {
  result: ApplyResult;
  onClose: () => void;
  onRevert: () => void;
}

export function DiffOverlay({ result, onClose, onRevert }: DiffOverlayProps): JSX.Element {
  return (
    <div className="atlas-overlay" role="dialog" aria-modal="true">
      <div className="atlas-modal">
        <header className="atlas-modal__header">
          <div>
            <div className="atlas-modal__title">Changes applied</div>
            <div className="atlas-modal__subtitle">{result.summary || 'Code generated.'}</div>
          </div>
          <button type="button" className="atlas-icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <VerificationBanner report={result.verification} />

        <div className="atlas-modal__body">
          {result.diff ? (
            <DiffView diff={result.diff} />
          ) : (
            <div className="atlas-modal__empty">No file changes were produced.</div>
          )}
        </div>
        <footer className="atlas-modal__footer">
          {result.revertable && (
            <button
              type="button"
              className="atlas-button atlas-button--danger"
              onClick={onRevert}
              title="Restore the files this generation changed"
            >
              Revert changes
            </button>
          )}
          <button type="button" className="atlas-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function VerificationBanner({ report }: { report: ApplyResult['verification'] }): JSX.Element | null {
  if (report.checks.length === 0) {
    return null;
  }
  return (
    <div className={`atlas-verify ${report.ok ? 'atlas-verify--ok' : 'atlas-verify--fail'}`}>
      <div className="atlas-verify__head">
        {report.ok
          ? '✓ Verified — the code realizes this architecture change.'
          : '⚠ Unverified — the architecture change is still pending until the code matches.'}
      </div>
      <ul className="atlas-verify__list">
        {report.checks.map((check, index) => (
          <li key={index} className={check.ok ? 'atlas-verify__ok' : 'atlas-verify__bad'}>
            {check.ok ? '✓' : '✕'} {check.label}
            {check.detail && <span className="atlas-verify__detail"> — {check.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { diff: string }): JSX.Element {
  return (
    <pre className="atlas-diff">
      {diff.split('\n').map((line, index) => (
        <div key={index} className={`atlas-diff__line ${diffClass(line)}`}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

function diffClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'atlas-diff__line--add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'atlas-diff__line--del';
  if (line.startsWith('@@')) return 'atlas-diff__line--hunk';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'atlas-diff__line--meta';
  return '';
}
