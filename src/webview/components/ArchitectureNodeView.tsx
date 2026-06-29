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

      <div className="atlas-node__icon">
        <NodeIcon type={node.type} />
      </div>
      <div className="atlas-node__body">
        <div className="atlas-node__name" title={node.name}>
          {node.name || 'Untitled'}
        </div>
        <div className="atlas-node__type">{definition.label}</div>
      </div>

      {data.issueSeverity && (
        <span
          className={`atlas-node__badge atlas-node__badge--${data.issueSeverity}`}
          title="This component has architecture issues"
          aria-hidden="true"
        />
      )}

      <Handle type="source" position={Position.Right} className="atlas-handle" />
    </div>
  );
}

export const ArchitectureNodeView = memo(ArchitectureNodeViewComponent);
