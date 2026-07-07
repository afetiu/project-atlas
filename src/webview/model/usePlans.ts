/**
 * Webview state for Plans — the propose → assess → decide → build workflow.
 *
 * This hook owns the plan lifecycle: the saved-plan list, the active plan, and
 * the sandbox handshake with `useArchitectureModel`. While a plan is open the
 * canvas edits the plan's *target* model (sandboxed — atlas.yaml untouched) and
 * this hook debounce-saves it to `atlas/plans/<file>` instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { planFileName, type Plan, type PlanSummary } from '../../shared/plans/plan';
import { onHostMessage, postToHost } from '../vscodeApi';
import type { ArchitectureModelApi } from './useArchitectureModel';

const SAVE_DEBOUNCE_MS = 600;

export interface ActivePlan {
  file: string;
  plan: Plan;
}

export interface PlansState {
  /** Saved plans, newest first. */
  plans: PlanSummary[];
  /** The plan currently open in plan mode, if any. */
  active: ActivePlan | null;
  /** Workspace-relative path of the ADR generated for the active plan. */
  adrPath: string | null;
  refresh: () => void;
  /** Start a new plan from the current model and enter plan mode. */
  startPlan: () => void;
  /** Open a saved plan in plan mode. */
  openPlan: (file: string) => void;
  rename: (name: string) => void;
  setRationale: (text: string) => void;
  /** Write the decision record into docs/adr/ and mark the plan decided. */
  generateAdr: () => void;
  /** Mark the plan applied and leave plan mode (called once a build is confirmed). */
  finalizeApply: () => void;
  /** Save and leave plan mode. */
  closePlan: () => void;
}

export function usePlans(api: ArchitectureModelApi): PlansState {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [adrPath, setAdrPath] = useState<string | null>(null);

  // The api object is rebuilt every render; message handlers and callbacks read
  // it through refs so subscriptions stay stable.
  const apiRef = useRef(api);
  apiRef.current = api;
  const activeRef = useRef(active);
  activeRef.current = active;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRequested = useRef<string | null>(null);

  const scheduleSave = useCallback((entry: ActivePlan) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      postToHost({ type: 'plan:save', file: entry.file, plan: entry.plan });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /** Cancel any pending debounce and save the given entry right now. */
  const flushSave = useCallback((entry: ActivePlan) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    postToHost({ type: 'plan:save', file: entry.file, plan: entry.plan });
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    return onHostMessage((message) => {
      if (message.type === 'plan:entries') {
        setPlans(message.plans);
      } else if (message.type === 'plan:loaded') {
        if (openRequested.current !== message.file) {
          return;
        }
        openRequested.current = null;
        setActive({ file: message.file, plan: message.plan });
        setAdrPath(null);
        apiRef.current.enterSandbox(message.plan.target);
      } else if (message.type === 'plan:adrSaved') {
        setAdrPath(message.path);
        setActive((current) =>
          current && current.file === message.file
            ? { ...current, plan: { ...current.plan, status: 'decided' } }
            : current,
        );
      }
    });
  }, []);

  // Load the saved-plan list once, so the command palette can offer plans.
  useEffect(() => {
    postToHost({ type: 'plan:list' });
  }, []);

  // While plan mode is on, canvas edits land in `api.model`; mirror them into
  // the active plan's target and debounce-save the plan file.
  useEffect(() => {
    const current = activeRef.current;
    if (!current || !api.sandboxed || current.plan.target === api.model) {
      return;
    }
    const next: ActivePlan = {
      ...current,
      plan: { ...current.plan, target: api.model },
    };
    setActive(next);
    scheduleSave(next);
  }, [api.model, api.sandboxed, scheduleSave]);

  const refresh = useCallback(() => postToHost({ type: 'plan:list' }), []);

  const startPlan = useCallback(() => {
    if (activeRef.current) {
      return;
    }
    const name = untitledName(plans);
    const plan: Plan = {
      name,
      rationale: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      target: apiRef.current.model,
    };
    const entry: ActivePlan = { file: planFileName(name), plan };
    setActive(entry);
    setAdrPath(null);
    apiRef.current.enterSandbox(plan.target);
    flushSave(entry);
  }, [plans, flushSave]);

  const openPlan = useCallback((file: string) => {
    if (activeRef.current) {
      return;
    }
    openRequested.current = file;
    postToHost({ type: 'plan:load', file });
  }, []);

  const editPlan = useCallback(
    (edits: Partial<Pick<Plan, 'name' | 'rationale'>>) => {
      setActive((current) => {
        if (!current) {
          return current;
        }
        const next: ActivePlan = { ...current, plan: { ...current.plan, ...edits } };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const rename = useCallback((name: string) => editPlan({ name }), [editPlan]);
  const setRationale = useCallback((text: string) => editPlan({ rationale: text }), [editPlan]);

  const generateAdr = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    // The message carries the plan so the record can't trail a debounced save.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    postToHost({ type: 'plan:adr', file: current.file, plan: current.plan });
  }, []);

  const finalizeApply = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    flushSave({ ...current, plan: { ...current.plan, status: 'applied' } });
    apiRef.current.exitSandbox();
    setActive(null);
    setAdrPath(null);
  }, [flushSave]);

  const closePlan = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    flushSave(current);
    apiRef.current.exitSandbox();
    setActive(null);
    setAdrPath(null);
  }, [flushSave]);

  return {
    plans,
    active,
    adrPath,
    refresh,
    startPlan,
    openPlan,
    rename,
    setRationale,
    generateAdr,
    finalizeApply,
    closePlan,
  };
}

/** First free "Untitled plan[ N]" name against the saved-plan files. */
function untitledName(plans: PlanSummary[]): string {
  const taken = new Set(plans.map((p) => p.file));
  let name = 'Untitled plan';
  for (let n = 2; taken.has(planFileName(name)); n += 1) {
    name = `Untitled plan ${n}`;
  }
  return name;
}
