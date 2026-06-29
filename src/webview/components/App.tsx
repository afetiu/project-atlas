/**
 * Top-level webview component: composes the workspace layout and owns the
 * lightweight selection state that ties the canvas and inspector together.
 *
 * All model state and persistence live in `useArchitectureModel`; this
 * component is concerned only with layout and selection wiring.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';

import type { NodeTypeId } from '../../shared/model/nodeTypes';
import { useArchitectureModel } from '../model/useArchitectureModel';
import { ArchitectureCanvas, type Selection } from './ArchitectureCanvas';
import { InspectorPanel } from './InspectorPanel';
import { Palette } from './Palette';
import { StatusBanner } from './StatusBanner';

const EMPTY_SELECTION: Selection = { nodeId: null, edgeId: null };

export function App(): JSX.Element {
  const api = useArchitectureModel();
  const { model, error } = api;

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const spawnCount = useRef(0);

  const selectedNode = useMemo(
    () => model.nodes.find((node) => node.id === selection.nodeId) ?? null,
    [model.nodes, selection.nodeId],
  );
  const selectedEdge = useMemo(
    () => model.edges.find((edge) => edge.id === selection.edgeId) ?? null,
    [model.edges, selection.edgeId],
  );

  // Palette click fallback: spawn near the top-left with a small cascade so
  // repeated clicks don't stack nodes exactly on top of each other.
  const handlePaletteAdd = useCallback(
    (type: NodeTypeId) => {
      const offset = (spawnCount.current % 6) * 36;
      spawnCount.current += 1;
      const id = api.addNode(type, { x: 120 + offset, y: 120 + offset });
      setSelection({ nodeId: id, edgeId: null });
    },
    [api],
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      api.removeNodes([id]);
      setSelection(EMPTY_SELECTION);
    },
    [api],
  );

  const handleDeleteEdge = useCallback(
    (id: string) => {
      api.removeEdges([id]);
      setSelection(EMPTY_SELECTION);
    },
    [api],
  );

  return (
    <div className="atlas-app">
      <header className="atlas-topbar">
        <div className="atlas-brand">
          <span className="atlas-brand__mark" aria-hidden="true" />
          <span className="atlas-brand__name">Atlas</span>
          <span className="atlas-brand__sub">Architecture</span>
        </div>
        <div className="atlas-topbar__meta">
          {model.nodes.length} nodes · {model.edges.length} connections
        </div>
      </header>

      {error && <StatusBanner message={error} />}

      <div className="atlas-workspace">
        <Palette onAdd={handlePaletteAdd} />

        <main className="atlas-stage">
          <ReactFlowProvider>
            <ArchitectureCanvas
              api={api}
              selection={selection}
              onSelectionChange={setSelection}
            />
          </ReactFlowProvider>
          {model.nodes.length === 0 && (
            <div className="atlas-empty" aria-hidden="true">
              <div className="atlas-empty__title">Design your architecture</div>
              <div className="atlas-empty__body">
                Drag a component from the palette onto the canvas to begin.
              </div>
            </div>
          )}
        </main>

        <InspectorPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNode={api.updateNode}
          onUpdateEdgeProtocol={api.updateEdgeProtocol}
          onDeleteNode={handleDeleteNode}
          onDeleteEdge={handleDeleteEdge}
        />
      </div>
    </div>
  );
}
