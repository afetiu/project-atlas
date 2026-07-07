/**
 * A collapsed bounded context: a single compact card that stands in for all of
 * its member components. Edges to/from the members re-route to this card, giving
 * a C4-style zoomed-out view. The expand control restores the members.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import type { ArchitectureGroupData } from '../adapters/reactFlowAdapter';
import { useCanvasCallbacks } from './canvasContext';

function CollapsedGroupNodeComponent({
  data,
  selected,
}: NodeProps<ArchitectureGroupData>): JSX.Element {
  const { onToggleCollapse } = useCanvasCallbacks();
  const { group, memberCount } = data;

  return (
    <div
      className={`atlas-collapsed${selected ? ' atlas-collapsed--selected' : ''}`}
      style={{ ['--group-color' as string]: group.color ?? '#c89b6c' }}
    >
      <Handle type="target" position={Position.Left} className="atlas-handle" />
      <span className="atlas-collapsed__dot" aria-hidden="true" />
      <div className="atlas-collapsed__body">
        <div className="atlas-collapsed__name" title={group.name}>
          {group.name}
        </div>
        <div className="atlas-collapsed__count">
          {memberCount} component{memberCount === 1 ? '' : 's'}
        </div>
      </div>
      <button
        type="button"
        className="atlas-collapsed__expand"
        title="Expand context"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => onToggleCollapse(group.id)}
      >
        ⤢
      </button>
      <Handle type="source" position={Position.Right} className="atlas-handle" />
    </div>
  );
}

export const CollapsedGroupNode = memo(CollapsedGroupNodeComponent);
