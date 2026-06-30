/**
 * The inspector: a side panel that edits the selected node, edge, or bounded
 * context. Edits flow straight back through the model mutators (debounced to
 * `atlas.yaml`). The panel holds no model state of its own.
 */

import React from 'react';

import { GROUP_COLORS } from '../../shared/model/groups';
import { NODE_TYPE_LIST, type NodeTypeId } from '../../shared/model/nodeTypes';
import { PROTOCOL_LIST, type ProtocolId } from '../../shared/model/protocols';
import type {
  ArchitectureEdge,
  ArchitectureGroup,
  ArchitectureNode,
} from '../../shared/model/types';
import type { GroupEdits, NodeEdits } from '../model/useArchitectureModel';

interface InspectorPanelProps {
  selectedNode: ArchitectureNode | null;
  selectedEdge: ArchitectureEdge | null;
  selectedGroup: ArchitectureGroup | null;
  groups: ArchitectureGroup[];
  onUpdateNode: (id: string, edits: NodeEdits) => void;
  onUpdateEdgeProtocol: (id: string, protocol: ProtocolId) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onSetNodeGroup: (nodeId: string, groupId: string | null) => void;
  onCreateContext: (nodeId: string) => void;
  onUpdateGroup: (id: string, edits: GroupEdits) => void;
  onDeleteGroup: (id: string) => void;
  onOpenFile: (path: string) => void;
  /** Focus+select the context name field (set right after creating a context). */
  autoFocusGroupName?: boolean;
}

export function InspectorPanel(props: InspectorPanelProps): JSX.Element {
  const { selectedNode, selectedEdge, selectedGroup } = props;

  return (
    <aside className="atlas-inspector" aria-label="Inspector">
      {selectedNode ? (
        <NodeInspector node={selectedNode} {...props} />
      ) : selectedGroup ? (
        <GroupInspector group={selectedGroup} {...props} />
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
  groups,
  onUpdateNode,
  onDeleteNode,
  onSetNodeGroup,
  onCreateContext,
  onOpenFile,
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

      <Field label="Bounded context">
        <select
          className="atlas-input"
          value={node.groupId ?? ''}
          onChange={(event) =>
            onSetNodeGroup(node.id, event.target.value === '' ? null : event.target.value)
          }
        >
          <option value="">None</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="atlas-button atlas-button--small atlas-field__action"
          onClick={() => onCreateContext(node.id)}
        >
          ＋ New context
        </button>
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

      {node.mapping?.path && (
        <Field label="Source">
          <button
            type="button"
            className="atlas-button atlas-source"
            title={`Open ${node.mapping.path}`}
            onClick={() => onOpenFile(node.mapping!.path!)}
          >
            <span className="atlas-source__path">{node.mapping.path}</span>
            <span className="atlas-source__open">Open ↗</span>
          </button>
        </Field>
      )}

      <ConnectionField node={node} onUpdateNode={onUpdateNode} />

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

/**
 * Binds a component to a live MCP server. A bound node is "live" — a handle to
 * a real, operable thing — rather than pure design intent. (Invoking the
 * server's tools is wired up host-side; this is where you connect it.)
 */
function ConnectionField({
  node,
  onUpdateNode,
}: {
  node: ArchitectureNode;
  onUpdateNode: InspectorPanelProps['onUpdateNode'];
}): JSX.Element {
  const bound = !!node.binding?.server;
  return (
    <Field label="Live connection (MCP)">
      <div className="atlas-binding">
        <span className={`atlas-binding__status${bound ? ' atlas-binding__status--live' : ''}`}>
          {bound ? '● Live' : '○ Intent only'}
        </span>
        <input
          className="atlas-input"
          type="text"
          value={node.binding?.server ?? ''}
          spellCheck={false}
          placeholder="MCP server (e.g. postgres, github)"
          onChange={(event) => {
            const server = event.target.value.trim();
            onUpdateNode(node.id, { binding: server ? { server } : undefined });
          }}
        />
      </div>
      {bound && node.binding?.tools && node.binding.tools.length > 0 && (
        <div className="atlas-binding__tools">
          {node.binding.tools.map((tool) => (
            <span key={tool} className="atlas-binding__tool">
              {tool}
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}

function GroupInspector({
  group,
  onUpdateGroup,
  onDeleteGroup,
  autoFocusGroupName,
}: { group: ArchitectureGroup } & InspectorPanelProps): JSX.Element {
  const nameRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (autoFocusGroupName) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
    // Re-focus when a different freshly-created context is selected.
  }, [autoFocusGroupName, group.id]);

  return (
    <div className="atlas-inspector__content">
      <Header title="Bounded context" subtitle={group.id} />

      <Field label="Name">
        <input
          ref={nameRef}
          className="atlas-input"
          type="text"
          value={group.name}
          spellCheck={false}
          onChange={(event) => onUpdateGroup(group.id, { name: event.target.value })}
        />
      </Field>

      <Field label="Colour">
        <div className="atlas-swatches">
          {GROUP_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`atlas-swatch${group.color === color ? ' atlas-swatch--active' : ''}`}
              style={{ background: color }}
              aria-label={`Use colour ${color}`}
              onClick={() => onUpdateGroup(group.id, { color })}
            />
          ))}
        </div>
      </Field>

      <Field label="Description">
        <textarea
          className="atlas-input atlas-textarea"
          value={group.description ?? ''}
          rows={4}
          placeholder="What does this bounded context own?"
          onChange={(event) => onUpdateGroup(group.id, { description: event.target.value })}
        />
      </Field>

      <button
        type="button"
        className="atlas-button atlas-button--danger"
        onClick={() => onDeleteGroup(group.id)}
      >
        Delete context
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
        Select a node, connection, or bounded context to edit it, or drag a
        component from the palette onto the canvas.
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
