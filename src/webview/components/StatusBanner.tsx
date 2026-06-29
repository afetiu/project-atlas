/**
 * A slim banner used to surface validation / parse errors coming from the host.
 * Kept separate so the messaging concern stays out of the layout component.
 */

interface StatusBannerProps {
  message: string;
}

export function StatusBanner({ message }: StatusBannerProps): JSX.Element {
  return (
    <div className="atlas-banner" role="alert">
      <span className="atlas-banner__dot" aria-hidden="true" />
      <span className="atlas-banner__text">{message}</span>
    </div>
  );
}
