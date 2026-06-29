/**
 * A compact, collapsible legend so a first-time viewer can decode the canvas:
 * which colour is which component type, plus the drift and issue indicators.
 * Only shows the types actually present, to stay quiet.
 */

import { useState } from 'react';

import { NODE_TYPE_LIST, type NodeTypeId } from '../../shared/model/nodeTypes';
import type { ArchitectureModel } from '../../shared/model/types';
import { NodeIcon } from './NodeIcon';

interface LegendProps {
  model: ArchitectureModel;
  activeFilter: ReadonlySet<NodeTypeId>;
  onToggleFilter: (type: NodeTypeId) => void;
}

export function Legend({ model, activeFilter, onToggleFilter }: LegendProps): JSX.Element | null {
  const [open, setOpen] = useState(true);
  if (model.nodes.length === 0) {
    return null;
  }
  const present = new Set(model.nodes.map((n) => n.type));
  const types = NODE_TYPE_LIST.filter((t) => present.has(t.id));
  const filtering = activeFilter.size > 0;

  return (
    <div className="atlas-legend">
      <button type="button" className="atlas-legend__toggle" onClick={() => setOpen((o) => !o)}>
        Legend{filtering ? ' · filtered' : ''} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="atlas-legend__body">
          {types.map((type) => {
            const active = activeFilter.has(type.id);
            return (
              <button
                key={type.id}
                type="button"
                className={`atlas-legend__row atlas-legend__row--filter${
                  filtering && !active ? ' atlas-legend__row--muted' : ''
                }`}
                title={active ? `Stop highlighting ${type.label}` : `Highlight ${type.label}`}
                aria-pressed={active}
                onClick={() => onToggleFilter(type.id)}
              >
                <span className="atlas-legend__icon" style={{ color: type.accent }}>
                  <NodeIcon type={type.id} size={13} />
                </span>
                <span>{type.label}</span>
              </button>
            );
          })}
          <div className="atlas-legend__divider" />
          <div className="atlas-legend__row">
            <span className="atlas-legend__swatch" style={{ background: '#f0a868' }} />
            <span>Drifted from code</span>
          </div>
          <div className="atlas-legend__row">
            <span className="atlas-legend__swatch atlas-legend__swatch--ring" />
            <span>Has issues</span>
          </div>
        </div>
      )}
    </div>
  );
}
