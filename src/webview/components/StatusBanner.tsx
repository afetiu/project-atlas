/**
 * A slim banner used to surface validation / parse / AI errors from the host.
 * Supports an optional action button (e.g. "Set API key") and dismissal.
 */

interface StatusBannerProps {
  message: string;
  tone?: 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onDismiss?: () => void;
}

export function StatusBanner({
  message,
  tone = 'error',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  onDismiss,
}: StatusBannerProps): JSX.Element {
  return (
    <div className={`atlas-banner atlas-banner--${tone}`} role="alert">
      <span className="atlas-banner__dot" aria-hidden="true" />
      <span className="atlas-banner__text">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="atlas-button atlas-button--small" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {secondaryActionLabel && onSecondaryAction && (
        <button
          type="button"
          className="atlas-button atlas-button--small"
          onClick={onSecondaryAction}
        >
          {secondaryActionLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          className="atlas-icon-button atlas-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
