/**
 * Top-level webview component: composes the workspace layout and wires together
 * the two state hooks — `useArchitectureModel` (the graph) and `useAiSession`
 * (the copilot). It owns only layout, selection, and the small amount of
 * coordination between those hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';

import { diffModels, summarizeDelta } from '../../shared/model/diff';
import {
  computeLens,
  type LensOverlay,
  type MapLens,
  type OverlayTone,
} from '../../shared/model/lenses';
import { findPath, type TracedPath } from '../../shared/model/path';
import { assessPlan, planProgress } from '../../shared/plans/plan';
import { groupBounds } from '../adapters/reactFlowAdapter';
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
import { useDocs } from '../model/useDocs';
import { useMcp } from '../model/useMcp';
import { usePlans } from '../model/usePlans';
import { getViewState, onHostMessage, postToHost, setViewState } from '../vscodeApi';
import { ApplyConfirm } from './ApplyConfirm';
import { ArchitectureCanvas, type Selection } from './ArchitectureCanvas';
import { AssistantPanel } from './AssistantPanel';
import { CommandPalette } from './CommandPalette';
import { DiffOverlay } from './DiffOverlay';
import { DocReader } from './DocReader';
import { DocsPanel } from './DocsPanel';
import { InsightsPanel } from './InsightsPanel';
import { InspectorPanel } from './InspectorPanel';
import { Legend } from './Legend';
import { LensSwitcher } from './LensSwitcher';
import { IssuesPanel } from './IssuesPanel';
import { Palette } from './Palette';
import { PlanPanel } from './PlanPanel';
import { StatusBanner } from './StatusBanner';
import { TemplatePicker } from './TemplatePicker';
import { TimeLapse, type HistoryEntry } from './TimeLapse';
import { Toolbar } from './Toolbar';
import type { ArchitectureTemplate } from '../../shared/templates/templates';

const EMPTY_SELECTION: Selection = { nodeId: null, edgeId: null, groupId: null };

type RightTab = 'inspector' | 'assistant' | 'issues' | 'insights' | 'docs' | 'plan';

/** View preferences persisted across reloads via the webview state API. */
type Theme = 'dark' | 'light';

interface PersistedView {
  rightTab?: RightTab;
  collapsedGroups?: string[];
  componentsCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  typeFilter?: string[];
  lens?: MapLens;
  theme?: Theme;
}

export function App(): JSX.Element {
  const api = useArchitectureModel();
  const ai = useAiSession();
  const mcp = useMcp();
  const docs = useDocs();
  const plans = usePlans(api);
  const reactFlow = useReactFlow();
  const { model, error } = api;

  const persisted = useRef<PersistedView>(getViewState<PersistedView>() ?? {}).current;
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [rightTab, setRightTab] = useState<RightTab>(persisted.rightTab ?? 'inspector');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    new Set(persisted.collapsedGroups ?? []),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pendingRenameGroupId, setPendingRenameGroupId] = useState<string | null>(null);
  const [componentsCollapsed, setComponentsCollapsed] = useState(persisted.componentsCollapsed ?? false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(persisted.sidebarCollapsed ?? false);
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<NodeTypeId>>(
    new Set(persisted.typeFilter as NodeTypeId[] | undefined),
  );
  const [lens, setLens] = useState<MapLens>(persisted.lens ?? 'structure');
  const [theme, setTheme] = useState<Theme>(persisted.theme ?? 'dark');
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [tracedPath, setTracedPath] = useState<TracedPath | null>(null);
  const [timelapse, setTimelapse] = useState<{ entries: HistoryEntry[]; index: number } | null>(null);
  const timelapsePending = useRef(false);
  // Time-lapse: entries arrive after 'history:list'; ignore when not requested.
  useEffect(() => {
    return onHostMessage((message) => {
      if (message.type === 'history:entries' && timelapsePending.current) {
        timelapsePending.current = false;
        if (message.entries.length > 0) {
          setTimelapse({ entries: message.entries, index: 0 });
        }
      }
    });
  }, []);

  const startTimelapse = useCallback(() => {
    // Time-lapse and plan mode both repaint the whole map; one at a time.
    if (plans.active) {
      return;
    }
    timelapsePending.current = true;
    postToHost({ type: 'history:list' });
  }, [plans.active]);

  const scrubTimelapse = useCallback((index: number) => {
    setTimelapse((current) => {
      if (!current) {
        return current;
      }
      const entry = current.entries[index];
      if (entry) {
        postToHost({ type: 'history:load', sha: entry.sha });
      }
      return { ...current, index };
    });
  }, []);

  const exitTimelapse = useCallback(() => {
    setTimelapse(null);
    postToHost({ type: 'history:exit' });
  }, []);

  // Persist view preferences so a reload restores collapsed panels and filters.
  useEffect(() => {
    setViewState<PersistedView>({
      // The Plan tab only exists while a plan is open, so it never persists.
      rightTab: rightTab === 'plan' ? 'inspector' : rightTab,
      collapsedGroups: [...collapsedGroups],
      componentsCollapsed,
      sidebarCollapsed,
      typeFilter: [...typeFilter],
      lens,
      theme,
    });
  }, [rightTab, collapsedGroups, componentsCollapsed, sidebarCollapsed, typeFilter, lens, theme]);

  const overlay = useMemo(
    () => computeLens(model, lens, { driftedNodeIds: ai.driftedNodeIds }),
    [model, lens, ai.driftedNodeIds],
  );

  /* ---- Plan mode: propose → assess → decide → build ---- */

  const planActive = plans.active !== null && api.sandboxed;

  // Live assessment of the sandboxed proposal against the real model.
  const planAssessment = useMemo(
    () => (planActive && api.baseModel ? assessPlan(api.baseModel, model) : null),
    [planActive, api.baseModel, model],
  );

  // Once a plan is decided, its baseline is frozen and the map tracks how much
  // of it the codebase has actually built — live, against the real model.
  const planTracking = useMemo(() => {
    const baseline = plans.active?.plan.baseline;
    if (!planActive || !baseline || !api.baseModel) {
      return null;
    }
    return planProgress(baseline, model, api.baseModel);
  }, [planActive, plans.active, model, api.baseModel]);

  // In plan mode the map becomes its own lens: changed components glow copper,
  // the blast radius glows amber, and everything untouched recedes. On a
  // decided plan, changes that have landed in the codebase turn green.
  const planOverlay = useMemo<LensOverlay | null>(() => {
    if (!planAssessment) {
      return null;
    }
    const nodeTone = new Map<string, OverlayTone>();
    for (const node of model.nodes) {
      nodeTone.set(node.id, 'muted');
    }
    for (const id of planAssessment.blastNodeIds) {
      nodeTone.set(id, 'warn');
    }
    for (const id of planAssessment.changedNodeIds) {
      nodeTone.set(id, 'info');
    }
    // Decided plans paint from their frozen baseline diff: the live diff
    // shrinks as reality catches up, but the plan's committed changes must
    // stay visible — green once built, copper while pending.
    for (const item of planTracking?.items ?? []) {
      if (item.nodeId) {
        nodeTone.set(item.nodeId, item.done ? 'ok' : 'info');
      }
    }
    const edgeTone = new Map<string, OverlayTone>();
    for (const edge of [...planAssessment.delta.addedEdges, ...planAssessment.delta.updatedEdges.map((u) => u.after)]) {
      edgeTone.set(edge.id, 'hot');
    }
    return { nodeTone, edgeTone, edgeWeight: new Map() };
  }, [planAssessment, planTracking, model.nodes]);

  // Entering plan mode opens the Plan tab; leaving it returns to the inspector.
  useEffect(() => {
    if (planActive) {
      setRightTab('plan');
      setSidebarCollapsed(false);
    } else {
      setRightTab((tab) => (tab === 'plan' ? 'inspector' : tab));
    }
  }, [planActive]);

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
    /** Extra bookkeeping once the user confirms (e.g. mark a plan applied). */
    onConfirmed?: () => void;
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
      // Leave plan mode (if any) before the host pushes the persisted target,
      // so the authoritative reload lands on the real map, not the sandbox.
      pendingApply.onConfirmed?.();
      ai.applyTarget(pendingApply.model, pendingApply.instruction);
      setPendingApply(null);
    }
  }, [pendingApply, ai]);

  // "Build it" from plan mode: apply the plan's target through the same
  // confirm-then-generate pipeline as any other change.
  const buildPlan = useCallback(() => {
    if (!plans.active || !api.baseModel) {
      return;
    }
    const changes = summarizeDelta(diffModels(api.baseModel, model));
    const instruction = plans.active.plan.rationale.trim() || plans.active.plan.name;
    setPendingApply({ model, instruction, changes, onConfirmed: plans.finalizeApply });
  }, [plans, api.baseModel, model]);

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
  const mapFromCode = useCallback(() => postToHost({ type: 'code:map' }), []);

  // Focus mode: sail into one district; Esc (or the pill) sails back out.
  const focusGroup = useCallback(
    (groupId: string | null) => {
      setFocusedGroupId(groupId);
      setTracedPath(null);
      if (groupId) {
        const bounds = groupBounds(model).get(groupId);
        if (bounds) {
          reactFlow.fitBounds(bounds, { padding: 0.25, duration: 450 });
        }
      } else {
        reactFlow.fitView({ padding: 0.1, duration: 450 });
      }
    },
    [model, reactFlow],
  );

  // Path tracing: shift-click a second component to light the route from the
  // selected one. Uses the previous selection when React Flow has already
  // re-selected the shift-clicked node by the time the click handler runs.
  const prevSelectedNode = useRef<string | null>(null);
  const requestTrace = useCallback(
    (targetId: string) => {
      const source =
        selection.nodeId && selection.nodeId !== targetId
          ? selection.nodeId
          : prevSelectedNode.current;
      if (!source || source === targetId) {
        return;
      }
      setTracedPath(findPath(model, source, targetId));
      setFocusedGroupId(null);
    },
    [model, selection.nodeId],
  );

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
      if (event.key === 'Escape' && !paletteOpen && !templatesOpen && !pendingApply) {
        if (timelapse) {
          exitTimelapse();
          return;
        }
        if (tracedPath) {
          setTracedPath(null);
          return;
        }
        if (focusedGroupId) {
          focusGroup(null);
          return;
        }
        if (selection.nodeId || selection.edgeId || selection.groupId) {
          setSelection(EMPTY_SELECTION);
          return;
        }
        if (planActive) {
          plans.closePlan();
          return;
        }
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
  }, [api, paletteOpen, templatesOpen, pendingApply, tracedPath, focusedGroupId, focusGroup, timelapse, exitTimelapse, planActive, plans, selection]);

  // Focus the inspector whenever something is selected on the canvas.
  const selectOnCanvas = useCallback((next: Selection) => {
    setSelection((current) => {
      if (current.nodeId && current.nodeId !== next.nodeId) {
        prevSelectedNode.current = current.nodeId;
      }
      return next;
    });
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

  const handlePickTemplate = useCallback(
    (template: ArchitectureTemplate) => {
      api.loadModel(template.build());
      setTemplatesOpen(false);
      setSelection(EMPTY_SELECTION);
      reactFlow.fitView({ duration: 400, padding: 0.2 });
    },
    [api, reactFlow],
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
    <div className="atlas-app" data-theme={theme}>
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
          {!planActive && model.nodes.length > 0 && (
            <button
              type="button"
              className="atlas-button atlas-button--small"
              onClick={plans.startPlan}
              title="Draft a change on the map without touching atlas.yaml"
            >
              ◈ Plan
            </button>
          )}
          <button
            type="button"
            className="atlas-button atlas-button--small atlas-topbar__search"
            onClick={() => setPaletteOpen(true)}
            title="Search components and run commands (Ctrl/Cmd+K)"
          >
            <span aria-hidden="true">⌘K</span> Search
          </button>
          <button
            type="button"
            className="atlas-button atlas-button--small atlas-theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Paper chart (light)' : 'Night chart (dark)'}
          >
            {theme === 'dark' ? '☀' : '☾'}
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
            overlay={planActive && planOverlay ? planOverlay : overlay}
            theme={theme}
            focusedGroupId={focusedGroupId}
            onFocusGroup={focusGroup}
            tracedPath={tracedPath}
            onRequestTrace={requestTrace}
          />
          {model.nodes.length > 0 && !planActive && <LensSwitcher lens={lens} onChange={setLens} />}
          {planActive && plans.active && (
            <button
              type="button"
              className="atlas-mode-pill atlas-mode-pill--plan"
              onClick={plans.closePlan}
              title="Close plan (Esc) — the draft is saved under atlas/plans/"
            >
              ◈ Plan: {plans.active.plan.name}
              <span className="atlas-mode-pill__x">✕</span>
            </button>
          )}
          {focusedGroupId && (
            <button
              type="button"
              className="atlas-mode-pill"
              onClick={() => focusGroup(null)}
              title="Exit focus (Esc)"
            >
              ◎ Focus: {model.groups.find((g) => g.id === focusedGroupId)?.name ?? focusedGroupId}
              <span className="atlas-mode-pill__x">✕</span>
            </button>
          )}
          {timelapse && (
            <TimeLapse
              entries={timelapse.entries}
              index={timelapse.index}
              onScrub={scrubTimelapse}
              onClose={exitTimelapse}
            />
          )}
          {tracedPath && (
            <button
              type="button"
              className="atlas-mode-pill"
              onClick={() => setTracedPath(null)}
              title="Clear path (Esc)"
            >
              ⇢ Path · {tracedPath.nodeIds.length - 1} hop
              {tracedPath.nodeIds.length - 1 === 1 ? '' : 's'}
              {tracedPath.reversed ? ' (reverse)' : ''}
              <span className="atlas-mode-pill__x">✕</span>
            </button>
          )}
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
                  onClick={mapFromCode}
                  title="Derive the map from the code's imports — instant, no AI"
                >
                  Map from code
                </button>
                <button
                  type="button"
                  className="atlas-button"
                  onClick={ai.detect}
                  title="Use AI to detect components and intent"
                >
                  Detect with AI
                </button>
                <button
                  type="button"
                  className="atlas-button"
                  onClick={() => setTemplatesOpen(true)}
                >
                  Start from a template
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
              {planActive && (
                <TabButton
                  label="Plan"
                  active={rightTab === 'plan'}
                  onClick={() => setRightTab('plan')}
                />
              )}
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
              <TabButton
                label="Insights"
                active={rightTab === 'insights'}
                onClick={() => setRightTab('insights')}
              />
              <TabButton
                label="Docs"
                active={rightTab === 'docs'}
                onClick={() => setRightTab('docs')}
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
          {rightTab === 'plan' && planActive && plans.active ? (
            <PlanPanel
              file={plans.active.file}
              plan={plans.active.plan}
              assessment={planAssessment}
              progress={planTracking}
              adrPath={plans.adrPath}
              nameOf={(id) => model.nodes.find((n) => n.id === id)?.name ?? id}
              onRename={plans.rename}
              onRationale={plans.setRationale}
              onGenerateAdr={plans.generateAdr}
              onBuild={buildPlan}
              onFocusNode={focusNode}
              onOpenFile={openFile}
            />
          ) : rightTab === 'docs' ? (
            <DocsPanel docs={docs} model={model} onFocusNode={focusNode} />
          ) : rightTab === 'insights' ? (
            <InsightsPanel model={model} onFocusNode={focusNode} />
          ) : rightTab === 'issues' ? (
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
              mcp={mcp}
              docs={docs}
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

      {templatesOpen && (
        <TemplatePicker onPick={handlePickTemplate} onClose={() => setTemplatesOpen(false)} />
      )}

      {docs.openPath && <DocReader docs={docs} onOpenFile={openFile} />}

      {paletteOpen && (
        <CommandPalette
          model={model}
          plans={plans.plans}
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
          onMapFromCode={() => {
            mapFromCode();
            setPaletteOpen(false);
          }}
          onArrange={() => {
            api.arrangeAsMap();
            setPaletteOpen(false);
            reactFlow.fitView({ duration: 400, padding: 0.2 });
          }}
          onTimelapse={() => {
            startTimelapse();
            setPaletteOpen(false);
          }}
          onNewPlan={() => {
            plans.startPlan();
            setPaletteOpen(false);
          }}
          onOpenPlan={(file) => {
            plans.openPlan(file);
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
