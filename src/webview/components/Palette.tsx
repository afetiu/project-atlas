/**
 * The node palette: a compact, draggable list of every node type.
 *
 * Dragging an item onto the canvas creates a node of that type (handled by the
 * canvas's drop logic). Clicking an item is offered as a keyboard/no-drag
 * fallback that drops the node at the canvas centre.
 *
 * The palette renders straight from the node-type registry, so new types appear
 * here automatically.
 */

import React from 'react';

import { NODE_TYPE_LIST, type NodeTypeId } from '../../shared/model/nodeTypes';
import { NodeIcon } from './NodeIcon';

export const PALETTE_DND_MIME = 'application/atlas-node-type';

interface PaletteProps {
  onAdd: (type: NodeTypeId) => void;
  onCollapse?: () => void;
}

export function Palette({ onAdd, onCollapse }: PaletteProps): JSX.Element {
  const handleDragStart = (event: React.DragEvent, type: NodeTypeId) => {
    event.dataTransfer.setData(PALETTE_DND_MIME, type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="atlas-palette" aria-label="Component palette">
      <div className="atlas-palette__heading">
        <span>Components</span>
        {onCollapse && (
          <button
            type="button"
            className="atlas-palette__collapse"
            title="Hide components"
            onClick={onCollapse}
          >
            ◂
          </button>
        )}
      </div>
      <div className="atlas-palette__list">
        {NODE_TYPE_LIST.map((definition) => (
          <button
            key={definition.id}
            type="button"
            className="atlas-palette__item"
            draggable
            onDragStart={(event) => handleDragStart(event, definition.id)}
            onClick={() => onAdd(definition.id)}
            style={{ ['--node-accent' as string]: definition.accent }}
            title={`Add ${definition.label}`}
          >
            <span className="atlas-palette__icon">
              <NodeIcon type={definition.id} size={16} />
            </span>
            <span className="atlas-palette__label">{definition.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
