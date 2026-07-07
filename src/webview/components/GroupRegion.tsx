/**
 * A bounded-context region: a translucent, labelled rectangle rendered behind
 * its member components. The body is click-through (so the components inside
 * stay interactive); only the header label is selectable, which opens the group
 * in the inspector.
 */

import { memo } from 'react';
import type { NodeProps } from 'reactflow';

import type { ArchitectureGroupData } from '../adapters/reactFlowAdapter';
import { useCanvasCallbacks } from './canvasContext';

function GroupRegionComponent({
  data,
  selected,
}: NodeProps<ArchitectureGroupData>): JSX.Element {
  const { group, memberCount } = data;
  const { onToggleCollapse } = useCanvasCallbacks();
  return (
    <div
      className={`atlas-group${selected ? ' atlas-group--selected' : ''}`}
      style={{ ['--group-color' as string]: group.color ?? '#c89b6c' }}
    >
      <div className="atlas-group__header" title={group.description || group.name}>
        <span className="atlas-group__dot" aria-hidden="true" />
        <span className="atlas-group__name">{group.name}</span>
        <span className="atlas-group__count">{memberCount}</span>
        <button
          type="button"
          className="atlas-group__collapse"
          title="Collapse context"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapse(group.id)}
        >
          ⤡
        </button>
      </div>
    </div>
  );
}

export const GroupRegion = memo(GroupRegionComponent);
