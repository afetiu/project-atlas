/**
 * Top-level webview component: composes the workspace layout and wires together
 * the two state hooks — `useArchitectureModel` (the graph) and `useAiSession`
 * (the copilot). It owns only layout, selection, and the small amount of
 * coordination between those hooks.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';

import type { NodeTypeId } from '../../shared/model/nodeTypes';
import { useAiSession } from '../model/useAiSession';
import { useArchitectureModel } from '../model/useArchitectureModel';
import { ArchitectureCanvas, type Selection } from './ArchitectureCanvas';
import { AssistantPanel } from './AssistantPanel';
import { DiffOverlay } from './DiffOverlay';
import { InspectorPanel } from './InspectorPanel';
import { Palette } from './Palette';
import { StatusBanner } from './StatusBanner';
import { Toolbar } from './Toolbar';

const EMPTY_SELECTION: Selection = { nodeId: null, edgeId: null };

type RightTab = 'inspector' | 'assistant';

export function App(): JSX.Element {
  const api = useArchitectureModel();
  const ai = useAiSession();
  const { model, error } = api;

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [rightTab, setRightTab] = useState<RightTab>('inspector');
  const spawnCount = useRef(0);

  const selectedNode = useMemo(
    () => model.nodes.find((node) => node.id === selection.nodeId) ?? null,
    [model.nodes, selection.nodeId],
  );
  const selectedEdge = useMemo(
    () => model.edges.find((edge) => edge.id === selection.edgeId) ?? null,
    [model.edges, selection.edgeId],
  );

  // Focus the inspector whenever something is selected on the canvas.
  const selectOnCanvas = useCallback((next: Selection) => {
    setSelection(next);
    if (next.nodeId || next.edgeId) {
      setRightTab('inspector');
    }
  }, []);

  const handlePaletteAdd = useCallback(
    (type: NodeTypeId) => {
      const offset = (spawnCount.current % 6) * 36;
      spawnCount.current += 1;
      const id = api.addNode(type, { x: 120 + offset, y: 120 + offset });
      selectOnCanvas({ nodeId: id, edgeId: null });
    },
    [api, selectOnCanvas],
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
        <Toolbar
          status={ai.status}
          pendingCount={ai.pendingSummary.length}
          onDetect={ai.detect}
          onApplyPending={() => ai.applyTarget(model)}
          onCancel={ai.cancel}
        />
        <div className="atlas-topbar__meta">
          {model.nodes.length} nodes · {model.edges.length} connections
        </div>
      </header>

      {error && <StatusBanner message={error} />}
      {ai.error && (
        <StatusBanner
          message={ai.error.message}
          actionLabel={ai.error.code === 'auth' ? 'Set API key' : undefined}
          onAction={ai.error.code === 'auth' ? ai.configureAuth : undefined}
          onDismiss={ai.dismissError}
        />
      )}

      <div className="atlas-workspace">
        <Palette onAdd={handlePaletteAdd} />

        <main className="atlas-stage">
          <ReactFlowProvider>
            <ArchitectureCanvas
              api={api}
              selection={selection}
              onSelectionChange={selectOnCanvas}
            />
          </ReactFlowProvider>
          {model.nodes.length === 0 && !ai.status.busy && (
            <div className="atlas-empty" aria-hidden="true">
              <div className="atlas-empty__title">Design your architecture</div>
              <div className="atlas-empty__body">
                Drag a component from the palette, or “Detect from code” to map an
                existing repository.
              </div>
            </div>
          )}
        </main>

        <aside className="atlas-sidebar">
          <div className="atlas-tabs" role="tablist">
            <TabButton
              label="Inspector"
              active={rightTab === 'inspector'}
              onClick={() => setRightTab('inspector')}
            />
            <TabButton
              label="Assistant"
              active={rightTab === 'assistant'}
              onClick={() => setRightTab('assistant')}
            />
          </div>
          {rightTab === 'inspector' ? (
            <InspectorPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onUpdateNode={api.updateNode}
              onUpdateEdgeProtocol={api.updateEdgeProtocol}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={handleDeleteEdge}
            />
          ) : (
            <AssistantPanel
              messages={ai.messages}
              status={ai.status}
              progress={ai.progress}
              onSend={ai.sendChat}
              onApplyProposal={(proposal) => ai.applyTarget(proposal.model, proposal.summary)}
            />
          )}
        </aside>
      </div>

      {ai.applyResult && (
        <DiffOverlay
          result={ai.applyResult}
          onClose={ai.dismissApply}
          onRevert={ai.revertApply}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`atlas-tab${active ? ' atlas-tab--active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
