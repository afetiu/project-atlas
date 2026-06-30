/**
 * A floating edge that attaches to the nearest sides of its endpoints and
 * renders the protocol as a crisp pill label. Replaces the fixed-handle
 * smoothstep edges so connections stay clean in any direction.
 */

import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type EdgeProps,
} from 'reactflow';

import { getEdgeParams } from '../adapters/getEdgeParams';

export function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  label,
  selected,
  data,
}: EdgeProps): JSX.Element | null {
  const sourceNode = useStore(useCallback((store) => store.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((store) => store.nodeInternals.get(target), [target]));

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });

  // The coupling lens widens busy "roads".
  const weight = (data as { weight?: number } | undefined)?.weight;
  const style = weight ? { strokeWidth: weight + 0.5 } : undefined;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`atlas-edge-label${selected ? ' atlas-edge-label--selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
