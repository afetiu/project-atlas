/**
 * A floating edge that attaches to the nearest sides of its endpoints and
 * renders the protocol as a crisp pill label. Replaces the fixed-handle
 * smoothstep edges so connections stay clean in any direction.
 */

import { memo, useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type EdgeProps,
} from 'reactflow';

import { getEdgeParams } from '../adapters/getEdgeParams';

function FloatingEdgeComponent({
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

  // The coupling lens widens busy "roads"; hover dim/highlight travels through
  // `data` because the label below renders in a portal, outside the edge element.
  const flags = data as { weight?: number; dim?: boolean; hl?: boolean } | undefined;
  const style = flags?.weight ? { strokeWidth: flags.weight + 0.5 } : undefined;
  const labelClass = [
    'atlas-edge-label',
    selected ? 'atlas-edge-label--selected' : '',
    flags?.dim ? 'atlas-edge-label--dim' : '',
    flags?.hl ? 'atlas-edge-label--hl' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={labelClass}
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

export const FloatingEdge = memo(FloatingEdgeComponent);
