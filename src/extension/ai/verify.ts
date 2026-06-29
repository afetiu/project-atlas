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
import { resolve } from 'path';
import { promisify } from 'util';

import type { ModelDelta } from '../../shared/model/diff';
import type { VerificationReport } from '../../shared/messaging/protocol';
import type { ArchitectureModel } from '../../shared/model/types';

const run = promisify(exec);

export async function verifyCodegen(
  cwd: string,
  delta: ModelDelta,
  model: ArchitectureModel,
  command: string | undefined,
): Promise<VerificationReport> {
  const checks: VerificationReport['checks'] = [];

  // 1. Mapped code exists for the components this change added or updated.
  const touched = new Set([
    ...delta.addedNodes.map((n) => n.id),
    ...delta.updatedNodes.map((u) => u.after.id),
  ]);
  for (const node of model.nodes) {
    const path = node.mapping?.path;
    if (!touched.has(node.id) || !path) {
      continue;
    }
    const ok = existsSync(resolve(cwd, path));
    checks.push({
      label: `Code present for “${node.name}” (${path})`,
      ok,
      detail: ok ? undefined : 'no file or directory at the mapped path',
    });
  }

  // 2. Optional project verify command (build/typecheck/test).
  if (command && command.trim().length > 0) {
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

  return { ok: checks.every((c) => c.ok), checks };
}
