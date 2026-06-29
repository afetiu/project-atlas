/**
 * Top-level webview component: composes the workspace layout and wires together
 * the two state hooks — `useArchitectureModel` (the graph) and `useAiSession`
 * (the copilot). It owns only layout, selection, and the small amount of
 * coordination between those hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';

import { diffModels, summarizeDelta } from '../../shared/model/diff';
import type { NodeTypeId } from '../../shared/model/nodeTypes';
import type { ArchitectureModel } from '../../shared/model/types';
import {
  BUILT_IN_RULES,
  evaluateRules,
  topSeverity,
  type RuleSeverity,
} from '../../shared/rules/rules';
import { useAiSession } from '../model/useAiSession';
import { useArchitectureModel } from '../model/useArchitectureModel';
import { getViewState, postToHost, setViewState } from '../vscodeApi';
import { ApplyConfirm } from './ApplyConfirm';
import { ArchitectureCanvas, type Selection } from './ArchitectureCanvas';
import { AssistantPanel } from './AssistantPanel';
import { CommandPalette } from './CommandPalette';
import { DiffOverlay } from './DiffOverlay';
import { InspectorPanel } from './InspectorPanel';
import { Legend } from './Legend';
import { IssuesPanel } from './IssuesPanel';
import { Palette } from './Palette';
import { StatusBanner } from './StatusBanner';
import { Toolbar } from './Toolbar';

const EMPTY_SELECTION: Selection = { nodeId: null, edgeId: null, groupId: null };

type RightTab = 'inspector' | 'assistant' | 'issues';

/** View preferences persisted across reloads via the webview state API. */
interface PersistedView {
  rightTab?: RightTab;
  collapsedGroups?: string[];
  componentsCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  typeFilter?: string[];
}

export function App(): JSX.Element {
  const api = useArchitectureModel();
  const ai = useAiSession();
  const reactFlow = useReactFlow();
  const { model, error } = api;

  const persisted = useRef<PersistedView>(getViewState<PersistedView>() ?? {}).current;
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [rightTab, setRightTab] = useState<RightTab>(persisted.rightTab ?? 'inspector');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    new Set(persisted.collapsedGroups ?? []),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingRenameGroupId, setPendingRenameGroupId] = useState<string | null>(null);
  const [componentsCollapsed, setComponentsCollapsed] = useState(persisted.componentsCollapsed ?? false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(persisted.sidebarCollapsed ?? false);
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<NodeTypeId>>(
    new Set(persisted.typeFilter as NodeTypeId[] | undefined),
  );
  // Persist view preferences so a reload restores collapsed panels and filters.
  useEffect(() => {
    setViewState<PersistedView>({
      rightTab,
      collapsedGroups: [...collapsedGroups],
      componentsCollapsed,
      sidebarCollapsed,
      typeFilter: [...typeFilter],
    });
  }, [rightTab, collapsedGroups, componentsCollapsed, sidebarCollapsed, typeFilter]);

  const toggleTypeFilter = useCallback((type: NodeTypeId) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);
  const [pendingApply, setPendingApply] = useState<{
    model: ArchitectureModel;
    instruction?: string;
    changes: string[];
  } | null>(null);
  const spawnCount = useRef(0);

  // Both apply paths go through an explicit confirmation before code is written.
  const requestApplyPending = useCallback(() => {
    setPendingApply({ model, changes: ai.pendingSummary });
  }, [model, ai.pendingSummary]);

  const requestApplyProposal = useCallback(
    (target: ArchitectureModel, instruction: string) => {
      const changes = summarizeDelta(diffModels(model, target));
      setPendingApply({ model: target, instruction, changes });
    },
    [model],
  );

  const confirmApply = useCallback(() => {
    if (pendingApply) {
      ai.applyTarget(pendingApply.model, pendingApply.instruction);
      setPendingApply(null);
    }
  }, [pendingApply, ai]);

  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const selectedNode = useMemo(
    () => model.nodes.find((node) => node.id === selection.nodeId) ?? null,
    [model.nodes, selection.nodeId],
  );
  const selectedEdge = useMemo(
    () => model.edges.find((edge) => edge.id === selection.edgeId) ?? null,
    [model.edges, selection.edgeId],
  );
  const selectedGroup = useMemo(
    () => model.groups.find((group) => group.id === selection.groupId) ?? null,
    [model.groups, selection.groupId],
  );

  const driftedNodes = useMemo(() => new Set(ai.driftedNodeIds), [ai.driftedNodeIds]);
  const violations = useMemo(
    () => evaluateRules(model, [...BUILT_IN_RULES, ...ai.customRules]),
    [model, ai.customRules],
  );
  const issueByNode = useMemo(() => {
    const grouped = new Map<string, RuleSeverity>();
    const byNode = new Map<string, typeof violations>();
    for (const v of violations) {
      if (!v.nodeId) continue;
      const list = byNode.get(v.nodeId) ?? [];
      list.push(v);
      byNode.set(v.nodeId, list);
    }
    for (const [nodeId, list] of byNode) {
      const sev = topSeverity(list);
      // Keep canvas badges high-signal: only warnings and errors, not info.
      if (sev && sev !== 'info') grouped.set(nodeId, sev);
    }
    return grouped;
  }, [violations]);

  const selectNode = useCallback(
    (id: string) => {
      setSelection({ nodeId: id, edgeId: null, groupId: null });
      setRightTab('inspector');
    },
    [],
  );
  const selectEdge = useCallback((id: string) => {
    setSelection({ nodeId: null, edgeId: id, groupId: null });
    setRightTab('inspector');
  }, []);

  const openFile = useCallback((path: string) => postToHost({ type: 'open:file', path }), []);

  // Select a node and pan/zoom to it, expanding its context first if collapsed.
  const focusNode = useCallback(
    (id: string) => {
      const node = model.nodes.find((n) => n.id === id);
      if (!node) {
        return;
      }
      if (node.groupId && collapsedGroups.has(node.groupId)) {
        toggleCollapse(node.groupId);
      }
      setSelection({ nodeId: id, edgeId: null, groupId: null });
      setRightTab('inspector');
      setTimeout(() => {
        const rfNode = reactFlow.getNode(id);
        const x = (rfNode?.position.x ?? node.position.x) + (rfNode?.width ?? 210) / 2;
        const y = (rfNode?.position.y ?? node.position.y) + (rfNode?.height ?? 60) / 2;
        reactFlow.setCenter(x, y, { zoom: 1.15, duration: 400 });
      }, 60);
    },
    [model.nodes, collapsedGroups, toggleCollapse, reactFlow],
  );

  // Undo/redo keyboard shortcuts — ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          api.redo();
        } else {
          api.undo();
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        api.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api]);

  // Focus the inspector whenever something is selected on the canvas.
  const selectOnCanvas = useCallback((next: Selection) => {
    setSelection(next);
    if (next.nodeId || next.edgeId || next.groupId) {
      setRightTab('inspector');
    }
  }, []);

  const handlePaletteAdd = useCallback(
    (type: NodeTypeId) => {
      const offset = (spawnCount.current % 6) * 36;
      spawnCount.current += 1;
      const id = api.addNode(type, { x: 120 + offset, y: 120 + offset });
      selectOnCanvas({ nodeId: id, edgeId: null, groupId: null });
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

  const handleDeleteGroup = useCallback(
    (id: string) => {
      // Deleting a context detaches all its members — warn about the blast radius.
      const memberCount = model.nodes.filter((n) => n.groupId === id).length;
      if (memberCount > 0) {
        const ok = window.confirm(
          `Delete this context? Its ${memberCount} component${
            memberCount === 1 ? '' : 's'
          } will be detached (not deleted). You can undo this.`,
        );
        if (!ok) {
          return;
        }
      }
      api.removeGroups([id]);
      setSelection(EMPTY_SELECTION);
    },
    [api, model.nodes],
  );

  // Create a context from the node inspector, assign the node, and open the new
  // context for renaming.
  const handleCreateContext = useCallback(
    (nodeId: string) => {
      const id = api.addGroup('New context');
      api.setNodeGroup(nodeId, id);
      setSelection({ nodeId: null, edgeId: null, groupId: id });
      setRightTab('inspector');
      setPendingRenameGroupId(id);
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
          canUndo={api.canUndo}
          canRedo={api.canRedo}
          onUndo={api.undo}
          onRedo={api.redo}
          onDetect={ai.detect}
          onApplyPending={requestApplyPending}
          onCancel={ai.cancel}
        />
        <div className="atlas-topbar__meta">
          <button
            type="button"
            className="atlas-button atlas-button--small atlas-topbar__search"
            onClick={() => setPaletteOpen(true)}
            title="Search components and run commands (Ctrl/Cmd+K)"
          >
            <span aria-hidden="true">⌘K</span> Search
          </button>
          <span className="atlas-topbar__counts">
            {model.nodes.length} nodes · {model.edges.length} connections
            {model.groups.length > 0 && ` · ${model.groups.length} contexts`}
          </span>
        </div>
      </header>

      {error && <StatusBanner message={error} />}
      {ai.notice && (
        <StatusBanner
          tone={ai.notice.tone === 'error' ? 'error' : 'info'}
          message={ai.notice.text}
          onDismiss={ai.dismissNotice}
        />
      )}
      {ai.driftedNodeIds.length > 0 && !ai.status.busy && (
        <StatusBanner
          tone="info"
          message={`${ai.driftedNodeIds.length} component${
            ai.driftedNodeIds.length === 1 ? '' : 's'
          } changed in code since the last detection.`}
          actionLabel="Show drifted"
          onAction={() => focusNode(ai.driftedNodeIds[0])}
          secondaryActionLabel="Re-detect"
          onSecondaryAction={ai.detect}
        />
      )}
      {ai.error && (
        <StatusBanner
          message={ai.error.message}
          actionLabel={ai.error.code === 'auth' ? 'Set API key' : undefined}
          onAction={ai.error.code === 'auth' ? ai.configureAuth : undefined}
          onDismiss={ai.dismissError}
        />
      )}

      <div className="atlas-workspace">
        {componentsCollapsed ? (
          <button
            type="button"
            className="atlas-rail"
            title="Show components"
            onClick={() => setComponentsCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <Palette onAdd={handlePaletteAdd} onCollapse={() => setComponentsCollapsed(true)} />
        )}

        <main className="atlas-stage">
          <ArchitectureCanvas
            api={api}
            selection={selection}
            onSelectionChange={selectOnCanvas}
            issueByNode={issueByNode}
            driftedNodes={driftedNodes}
            onOpenFile={openFile}
            collapsedGroups={collapsedGroups}
            onToggleCollapse={toggleCollapse}
            typeFilter={typeFilter}
          />
          <Legend model={model} activeFilter={typeFilter} onToggleFilter={toggleTypeFilter} />
          {model.nodes.length === 0 && ai.status.busy && (
            <div className="atlas-empty">
              <div className="atlas-empty__title">
                <span className="atlas-activity__spinner" aria-hidden="true" />{' '}
                {ai.status.label ?? 'Analyzing repository…'}
              </div>
              {ai.progress.length > 0 && (
                <div className="atlas-empty__body atlas-empty__progress">
                  {ai.progress[ai.progress.length - 1]}
                </div>
              )}
            </div>
          )}
          {model.nodes.length === 0 && !ai.status.busy && (
            <div className="atlas-empty">
              <div className="atlas-empty__title">Design your architecture</div>
              <div className="atlas-empty__body">
                Map an existing repository with AI, or start from a blank canvas.
              </div>
              <div className="atlas-empty__actions">
                <button
                  type="button"
                  className="atlas-button atlas-button--accent"
                  onClick={ai.detect}
                >
                  Detect from code
                </button>
                <button
                  type="button"
                  className="atlas-button"
                  onClick={() => handlePaletteAdd('service')}
                >
                  Add a component
                </button>
              </div>
            </div>
          )}
        </main>

        {sidebarCollapsed ? (
          <button
            type="button"
            className="atlas-rail"
            title="Show panel"
            onClick={() => setSidebarCollapsed(false)}
          >
            ◂
          </button>
        ) : (
        <aside className="atlas-sidebar">
          <div className="atlas-tabs">
            <div className="atlas-tabs__list" role="tablist" aria-label="Inspector panels">
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
              <TabButton
                label="Issues"
                active={rightTab === 'issues'}
                onClick={() => setRightTab('issues')}
                badge={violations.length}
              />
            </div>
            <button
              type="button"
              className="atlas-tabs__collapse"
              title="Hide panel"
              aria-label="Hide panel"
              onClick={() => setSidebarCollapsed(true)}
            >
              ▸
            </button>
          </div>
          {rightTab === 'issues' ? (
            <IssuesPanel
              violations={violations}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
            />
          ) : rightTab === 'inspector' ? (
            <InspectorPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              selectedGroup={selectedGroup}
              groups={model.groups}
              onUpdateNode={api.updateNode}
              onUpdateEdgeProtocol={api.updateEdgeProtocol}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={handleDeleteEdge}
              onSetNodeGroup={api.setNodeGroup}
              onCreateContext={handleCreateContext}
              onUpdateGroup={api.updateGroup}
              onDeleteGroup={handleDeleteGroup}
              onOpenFile={openFile}
              autoFocusGroupName={!!selectedGroup && selectedGroup.id === pendingRenameGroupId}
            />
          ) : (
            <AssistantPanel
              messages={ai.messages}
              status={ai.status}
              progress={ai.progress}
              onSend={ai.sendChat}
              onApplyProposal={(proposal) => requestApplyProposal(proposal.model, proposal.summary)}
            />
          )}
        </aside>
        )}
      </div>

      {ai.applyResult && (
        <DiffOverlay
          result={ai.applyResult}
          reverting={ai.reverting}
          onClose={ai.dismissApply}
          onRevert={ai.revertApply}
        />
      )}

      {pendingApply && (
        <ApplyConfirm
          changes={pendingApply.changes}
          onConfirm={confirmApply}
          onCancel={() => setPendingApply(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          model={model}
          onClose={() => setPaletteOpen(false)}
          onFocusNode={(id) => {
            focusNode(id);
            setPaletteOpen(false);
          }}
          onAddNode={(type) => {
            handlePaletteAdd(type);
            setPaletteOpen(false);
          }}
          onDetect={() => {
            ai.detect();
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
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
      {badge ? <span className="atlas-tab__badge">{badge}</span> : null}
    </button>
  );
}
