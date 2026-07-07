/**
 * Lightweight context for canvas callbacks that custom node components need but
 * can't receive as props (React Flow constructs nodes from data). Currently
 * carries the collapse/expand toggle for bounded contexts.
 */

import { createContext, useContext } from 'react';

interface CanvasCallbacks {
  onToggleCollapse: (groupId: string) => void;
  onFocusGroup: (groupId: string) => void;
}

export const CanvasContext = createContext<CanvasCallbacks>({
  onToggleCollapse: () => undefined,
  onFocusGroup: () => undefined,
});

export const useCanvasCallbacks = (): CanvasCallbacks => useContext(CanvasContext);
