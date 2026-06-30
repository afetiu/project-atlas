/**
 * A modal that offers starter architecture templates, so a first-time user
 * never faces a blank canvas. Picking one loads a complete, editable graph.
 */

import { useRef } from 'react';

import { TEMPLATES, type ArchitectureTemplate } from '../../shared/templates/templates';
import { useOverlay } from '../hooks/useOverlay';

interface TemplatePickerProps {
  onPick: (template: ArchitectureTemplate) => void;
  onClose: () => void;
}

export function TemplatePicker({ onPick, onClose }: TemplatePickerProps): JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null);
  useOverlay(modalRef, onClose);

  return (
    <div className="atlas-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="atlas-modal atlas-modal--templates"
        role="dialog"
        aria-modal="true"
        aria-label="Start from a template"
        tabIndex={-1}
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="atlas-modal__header">
          <div>
            <div className="atlas-modal__title">Start from a template</div>
            <div className="atlas-modal__subtitle">Pick a shape to begin — everything stays editable.</div>
          </div>
          <button type="button" className="atlas-icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="atlas-templates">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="atlas-template"
              onClick={() => onPick(template)}
            >
              <span className="atlas-template__name">{template.name}</span>
              <span className="atlas-template__desc">{template.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
