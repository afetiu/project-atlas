/**
 * Closes the architecture→code loop: after generation, verify that the code
 * actually realizes the change before trusting it as "the code reflects the
 * model." Two checks:
 *   1. Every added/updated component with a code mapping now has a file/dir at
 *      that path (a new "service" node should have code where it claims to).
 *   2. An optional, user-configured verify command (e.g. `npm run typecheck`)
 *      succeeds. The extension runs this — never the agent — so it's controlled.
 *
 * Only when verification passes does the panel advance the baseline; otherwise
 * the change stays visibly pending and the report says exactly what's missing.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

import type { ModelDelta } from '../../shared/model/diff';
import type { VerificationReport } from '../../shared/messaging/protocol';
import type { ArchitectureModel } from '../../shared/model/types';
import { resolveWithinRoot } from '../workspace/paths';

const run = promisify(exec);

export interface VerifyOptions {
  /** Optional project verify command (build/typecheck/test). */
  command: string | undefined;
  /**
   * Whether the workspace is trusted. The verify command is a shell string that
   * can be set by workspace settings (`.vscode/settings.json`), i.e. untrusted
   * repo content — so it only runs in a trusted workspace.
   */
  trusted: boolean;
  /** Workspace-relative files the agent reported writing this run. */
  touchedFiles: string[];
}

export async function verifyCodegen(
  cwd: string,
  delta: ModelDelta,
  model: ArchitectureModel,
  options: VerifyOptions,
): Promise<VerificationReport> {
  const checks: VerificationReport['checks'] = [];

  const addedIds = new Set(delta.addedNodes.map((n) => n.id));
  const updatedIds = new Set(delta.updatedNodes.map((u) => u.after.id));
  const touchedAbs = options.touchedFiles
    .map((f) => resolveWithinRoot(cwd, f))
    .filter((p): p is string => p !== null);

  // 1. Mapped code exists for added/updated components — and for *updated* ones
  // the generation must actually have written under the mapped path (existence
  // alone would pass a no-op apply on a path that already existed).
  for (const node of model.nodes) {
    const path = node.mapping?.path;
    if (!path || (!addedIds.has(node.id) && !updatedIds.has(node.id))) {
      continue;
    }
    const abs = resolveWithinRoot(cwd, path);
    const exists = abs !== null && existsSync(abs);
    if (!exists) {
      checks.push({
        label: `Code present for “${node.name}” (${path})`,
        ok: false,
        detail: abs === null ? 'mapped path is outside the workspace' : 'no file or directory at the mapped path',
      });
      continue;
    }
    if (updatedIds.has(node.id) && touchedAbs.length > 0) {
      const wrote = touchedAbs.some((f) => f === abs || f.startsWith(abs + '/'));
      checks.push({
        label: `Code updated for “${node.name}” (${path})`,
        ok: wrote,
        detail: wrote ? undefined : 'no generated change landed under the mapped path',
      });
    } else {
      checks.push({ label: `Code present for “${node.name}” (${path})`, ok: true });
    }
  }

  // 2. Optional project verify command — only in a trusted workspace.
  const command = options.command?.trim();
  if (command) {
    if (!options.trusted) {
      checks.push({
        label: `Verify command skipped: ${command}`,
        ok: true,
        detail: 'workspace is not trusted; command not run',
      });
    } else {
      try {
        await run(command, { cwd, timeout: 180_000, maxBuffer: 1 << 24 });
        checks.push({ label: `Verify command: ${command}`, ok: true });
      } catch (error) {
        const detail =
          (error as { stderr?: string; message?: string }).stderr ||
          (error as Error).message ||
          'command failed';
        checks.push({ label: `Verify command: ${command}`, ok: false, detail: detail.slice(0, 600) });
      }
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
