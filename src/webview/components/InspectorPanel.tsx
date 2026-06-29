/**
 * The inspector: a side panel that edits the currently selected node or edge.
 *
 * Edits are pushed straight back through the model mutators, so every keystroke
 * flows into `atlas.yaml` (debounced). The panel is intentionally "dumb": it
 * holds no model state of its own and derives everything from props.
 */

import React from 'react';

import { NODE_TYPE_LIST, type NodeTypeId } from '../../shared/model/nodeTypes';
import { PROTOCOL_LIST, type ProtocolId } from '../../shared/model/protocols';
import type { ArchitectureEdge, ArchitectureNode } from '../../shared/model/types';
import type { NodeEdits } from '../model/useArchitectureModel';

interface InspectorPanelProps {
  selectedNode: ArchitectureNode | null;
  selectedEdge: ArchitectureEdge | null;
  onUpdateNode: (id: string, edits: NodeEdits) => void;
  onUpdateEdgeProtocol: (id: string, protocol: ProtocolId) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function InspectorPanel(props: InspectorPanelProps): JSX.Element {
  const { selectedNode, selectedEdge } = props;

  return (
    <aside className="atlas-inspector" aria-label="Inspector">
      {selectedNode ? (
        <NodeInspector node={selectedNode} {...props} />
      ) : selectedEdge ? (
        <EdgeInspector edge={selectedEdge} {...props} />
      ) : (
        <EmptyInspector />
      )}
    </aside>
  );
}

function NodeInspector({
  node,
  onUpdateNode,
  onDeleteNode,
}: { node: ArchitectureNode } & InspectorPanelProps): JSX.Element {
  return (
    <div className="atlas-inspector__content">
      <Header title="Node" subtitle={node.id} />

      <Field label="Name">
        <input
          className="atlas-input"
          type="text"
          value={node.name}
          spellCheck={false}
          onChange={(event) => onUpdateNode(node.id, { name: event.target.value })}
        />
      </Field>

      <Field label="Type">
        <select
          className="atlas-input"
          value={node.type}
          onChange={(event) =>
            onUpdateNode(node.id, { type: event.target.value as NodeTypeId })
          }
        >
          {NODE_TYPE_LIST.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Description">
        <textarea
          className="atlas-input atlas-textarea"
          value={node.description}
          rows={5}
          placeholder="What is this component responsible for?"
          onChange={(event) => onUpdateNode(node.id, { description: event.target.value })}
        />
      </Field>

      <button
        type="button"
        className="atlas-button atlas-button--danger"
        onClick={() => onDeleteNode(node.id)}
      >
        Delete node
      </button>
    </div>
  );
}

function EdgeInspector({
  edge,
  onUpdateEdgeProtocol,
  onDeleteEdge,
}: { edge: ArchitectureEdge } & InspectorPanelProps): JSX.Element {
  return (
    <div className="atlas-inspector__content">
      <Header title="Connection" subtitle={`${edge.source} → ${edge.target}`} />

      <Field label="Protocol">
        <select
          className="atlas-input"
          value={edge.protocol}
          onChange={(event) =>
            onUpdateEdgeProtocol(edge.id, event.target.value as ProtocolId)
          }
        >
          {PROTOCOL_LIST.map((protocol) => (
            <option key={protocol.id} value={protocol.id}>
              {protocol.label}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        className="atlas-button atlas-button--danger"
        onClick={() => onDeleteEdge(edge.id)}
      >
        Delete connection
      </button>
    </div>
  );
}

function EmptyInspector(): JSX.Element {
  return (
    <div className="atlas-inspector__empty">
      <div className="atlas-inspector__empty-title">Nothing selected</div>
      <p className="atlas-inspector__empty-body">
        Select a node or connection to edit it, or drag a component from the
        palette onto the canvas.
      </p>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }): JSX.Element {
  return (
    <header className="atlas-inspector__header">
      <div className="atlas-inspector__title">{title}</div>
      <div className="atlas-inspector__subtitle" title={subtitle}>
        {subtitle}
      </div>
    </header>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="atlas-field">
      <span className="atlas-field__label">{label}</span>
      {children}
    </label>
  );
}
