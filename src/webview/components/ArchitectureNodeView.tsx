/**
 * The custom React Flow node: a rounded card showing a type icon, the node's
 * name, and its type label. Connection handles sit on the left and right edges.
 *
 * This component is purely presentational — it reads from `data.node` and emits
 * nothing back except through React Flow's built-in interactions (drag, select,
 * connect), which the canvas translates into model mutations.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { getNodeTypeDefinition } from '../../shared/model/nodeTypes';
import type { ArchitectureNodeData } from '../adapters/reactFlowAdapter';
import { NodeIcon } from './NodeIcon';

function ArchitectureNodeViewComponent({
  data,
  selected,
}: NodeProps<ArchitectureNodeData>): JSX.Element {
  const { node } = data;
  const definition = getNodeTypeDefinition(node.type);

  return (
    <div
      className={`atlas-node${selected ? ' atlas-node--selected' : ''}`}
      style={{ ['--node-accent' as string]: definition.accent }}
    >
      <Handle type="target" position={Position.Left} className="atlas-handle" />

      {data.drifted && (
        <span
          className="atlas-node__drift"
          title="Code changed since the last detection"
          aria-label="drifted from code"
        />
      )}

      <div className="atlas-node__icon">
        <NodeIcon type={node.type} />
      </div>
      <div className="atlas-node__body">
        <div className="atlas-node__name" title={node.name}>
          {node.name || 'Untitled'}
        </div>
        <div className="atlas-node__type">
          {definition.label}
          {mappingHint(node) && <span className="atlas-node__tech">{mappingHint(node)}</span>}
        </div>
      </div>

      {data.issueSeverity && (
        <span
          className={`atlas-node__badge atlas-node__badge--${data.issueSeverity}`}
          title={`This component has a ${data.issueSeverity}`}
          aria-label={`${data.issueSeverity} on this component`}
        >
          {data.issueSeverity === 'error' ? '!' : '▲'}
        </span>
      )}

      <Handle type="source" position={Position.Right} className="atlas-handle" />
    </div>
  );
}

/** A short tech hint shown next to the type (framework › language › path leaf). */
function mappingHint(node: ArchitectureNodeData['node']): string | undefined {
  const mapping = node.mapping;
  if (!mapping) {
    return undefined;
  }
  if (mapping.framework) return mapping.framework;
  if (mapping.language) return mapping.language;
  if (mapping.path) return mapping.path.split('/').pop();
  return undefined;
}

export const ArchitectureNodeView = memo(ArchitectureNodeViewComponent);
