/**
 * Minimal, monochrome line icons for each node type.
 *
 * Icons are hand-drawn SVGs using `currentColor` so they inherit the node's
 * accent. Keeping them inline avoids pulling in an icon dependency for six
 * glyphs, in line with the "no unnecessary dependencies" goal.
 */

import React from 'react';

import type { NodeTypeId } from '../../shared/model/nodeTypes';

interface NodeIconProps {
  type: NodeTypeId;
  size?: number;
}

const PATHS: Record<NodeTypeId, React.ReactNode> = {
  service: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 12h8M12 8v8" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
    </>
  ),
  queue: (
    <>
      <rect x="3.5" y="6" width="4" height="12" rx="1" />
      <rect x="10" y="6" width="4" height="12" rx="1" />
      <rect x="16.5" y="6" width="4" height="12" rx="1" />
    </>
  ),
  externalApi: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" />
    </>
  ),
  frontend: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  cache: (
    <>
      <path d="M13 3 5 13h6l-2 8 8-10h-6l2-8z" />
    </>
  ),
};

export function NodeIcon({ type, size = 18 }: NodeIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[type]}
    </svg>
  );
}
