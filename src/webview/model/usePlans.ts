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
  /**
   * A build of this plan was confirmed: save it, leave plan mode, and watch
   * the apply pipeline — the plan is marked applied only once the generated
   * code VERIFIES, so the status never claims more than reality.
   */
  beginBuild: () => void;
  /** Mark the plan abandoned and leave plan mode (the file stays on disk). */
  abandonPlan: () => void;
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
  // The plan whose build is in flight; its status advances to 'applied' only
  // when the apply pipeline reports verified success. `revertWatch` remembers
  // the applied plan so reverting that same apply restores its prior status.
  const buildInFlight = useRef<ActivePlan | null>(null);
  const revertWatch = useRef<ActivePlan | null>(null);
  const plansRef = useRef(plans);
  plansRef.current = plans;

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
      } else if (message.type === 'apply:done') {
        const pending = buildInFlight.current;
        buildInFlight.current = null;
        if (pending && message.verification.ok) {
          postToHost({
            type: 'plan:save',
            file: pending.file,
            plan: { ...pending.plan, status: 'applied' },
          });
          // If THIS apply gets reverted, the plan's prior status comes back.
          revertWatch.current = pending;
        } else {
          // A failed verification leaves the plan's status untouched (still
          // true), and any apply that wasn't this plan's supersedes the watch.
          revertWatch.current = null;
        }
      } else if (message.type === 'apply:reverted') {
        // The generated code was rolled back: the plan is no longer realized,
        // so restore the status it had before the build.
        const watched = revertWatch.current;
        revertWatch.current = null;
        if (watched && message.ok) {
          postToHost({ type: 'plan:save', file: watched.file, plan: watched.plan });
        }
      } else if (message.type === 'plan:adrSaved') {
        setAdrPath(message.path);
        // Mirror what the host just persisted: decided status and the frozen
        // baseline (the real model), so progress tracking starts immediately.
        const baseline = apiRef.current.baseModel;
        setActive((current) =>
          current && current.file === message.file
            ? {
                ...current,
                plan: {
                  ...current.plan,
                  status: 'decided',
                  ...(baseline ? { baseline } : {}),
                },
              }
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

  /**
   * A named draft sheds its "untitled" file name the first time it leaves the
   * editor (close / decide / build), so plan files read like their plans —
   * without churning the file on every rename keystroke.
   */
  const ensureSlug = useCallback((entry: ActivePlan): ActivePlan => {
    if (entry.plan.status !== 'draft' || !entry.file.startsWith('untitled-plan')) {
      return entry;
    }
    const desired = planFileName(entry.plan.name);
    if (
      desired === entry.file ||
      desired === 'untitled-plan.yaml' ||
      plansRef.current.some((p) => p.file === desired)
    ) {
      return entry; // unnamed, unchanged, or the name is taken — keep the file
    }
    postToHost({ type: 'plan:rename', from: entry.file, to: desired, plan: entry.plan });
    return { ...entry, file: desired };
  }, []);

  const generateAdr = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const entry = ensureSlug(current);
    if (entry !== current) {
      setActive(entry);
      activeRef.current = entry;
    }
    // The message carries the plan so the record can't trail a debounced save.
    postToHost({ type: 'plan:adr', file: entry.file, plan: entry.plan });
  }, [ensureSlug]);

  const leavePlanMode = useCallback(() => {
    apiRef.current.exitSandbox();
    setActive(null);
    setAdrPath(null);
  }, []);

  const beginBuild = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    const entry = ensureSlug(current);
    flushSave(entry);
    buildInFlight.current = entry;
    leavePlanMode();
  }, [flushSave, ensureSlug, leavePlanMode]);

  const abandonPlan = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    flushSave({ ...current, plan: { ...current.plan, status: 'abandoned' } });
    leavePlanMode();
  }, [flushSave, leavePlanMode]);

  const closePlan = useCallback(() => {
    const current = activeRef.current;
    if (!current) {
      return;
    }
    flushSave(ensureSlug(current));
    leavePlanMode();
  }, [flushSave, ensureSlug, leavePlanMode]);

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
    beginBuild,
    abandonPlan,
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
