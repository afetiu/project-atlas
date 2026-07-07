/**
 * ⌘K / Ctrl+K command palette — Raycast-style. Unifies three things that large
 * maps need: search-and-jump to any component, quick-add a node of any type, and
 * run detection. Keyboard-first: type to filter, arrows to move, Enter to run.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  NODE_TYPE_LIST,
  getNodeTypeDefinition,
  type NodeTypeId,
} from '../../shared/model/nodeTypes';
import type { ArchitectureModel } from '../../shared/model/types';
import type { PlanSummary } from '../../shared/plans/plan';
import { useOverlay } from '../hooks/useOverlay';

interface CommandItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

interface CommandPaletteProps {
  model: ArchitectureModel;
  plans: PlanSummary[];
  onClose: () => void;
  onFocusNode: (id: string) => void;
  onAddNode: (type: NodeTypeId) => void;
  onDetect: () => void;
  onMapFromCode: () => void;
  onArrange: () => void;
  onTimelapse: () => void;
  onNewPlan: () => void;
  onOpenPlan: (file: string) => void;
}

export function CommandPalette({
  model,
  plans,
  onClose,
  onFocusNode,
  onAddNode,
  onDetect,
  onMapFromCode,
  onArrange,
  onTimelapse,
  onNewPlan,
  onOpenPlan,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useOverlay(modalRef, onClose);
  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      ...NODE_TYPE_LIST.map((definition) => ({
        id: `add-${definition.id}`,
        label: `Add ${definition.label}`,
        hint: 'Create',
        run: () => onAddNode(definition.id),
      })),
      { id: 'map-code', label: 'Map from code', hint: 'Static', run: onMapFromCode },
      { id: 'detect', label: 'Detect with AI', hint: 'AI', run: onDetect },
      { id: 'arrange', label: 'Arrange as map', hint: 'Layout', run: onArrange },
      { id: 'timelapse', label: 'Time-lapse', hint: 'History', run: onTimelapse },
      { id: 'new-plan', label: 'New plan', hint: 'Plan', run: onNewPlan },
      ...plans.map((plan) => ({
        id: `plan-${plan.file}`,
        label: `Open plan: ${plan.name}`,
        hint: plan.status === 'draft' ? 'Plan · draft' : `Plan · ${plan.status}`,
        run: () => onOpenPlan(plan.file),
      })),
    ];
    const nodes: CommandItem[] = model.nodes.map((node) => ({
      id: `node-${node.id}`,
      label: node.name,
      hint: getNodeTypeDefinition(node.type).label,
      run: () => onFocusNode(node.id),
    }));

    const all = [...nodes, ...actions];
    const q = query.trim().toLowerCase();
    return q ? all.filter((item) => item.label.toLowerCase().includes(q)) : all;
  }, [model.nodes, plans, query, onAddNode, onDetect, onMapFromCode, onFocusNode, onArrange, onTimelapse, onNewPlan, onOpenPlan]);

  // Keep the active index in range as the list shrinks.
  useEffect(() => setActive(0), [query]);
  const clampedActive = Math.min(active, Math.max(items.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[clampedActive]?.run();
    }
  };

  return (
    <div className="atlas-overlay atlas-overlay--top" role="presentation" onMouseDown={onClose}>
      <div
        className="atlas-palette-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="atlas-palette-modal__input"
          placeholder="Search components or run a command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="atlas-palette-modal__list">
          {items.length === 0 && <div className="atlas-palette-modal__empty">No matches</div>}
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`atlas-command${index === clampedActive ? ' atlas-command--active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={item.run}
            >
              <span className="atlas-command__label">{item.label}</span>
              <span className="atlas-command__hint">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
