/**
 * Drift detection: which components' code has changed since the architecture
 * was last synced. This is the cheap, always-on companion to detection — it's a
 * pure git query (no AI), so it can run on every file change to keep the map
 * honest about whether it still reflects the code.
 */

import type { ArchitectureModel } from '../../shared/model/types';
import { getChangedFilesSince } from './git';

/** Ids of nodes whose mapped path contains a file changed since `baselineCommit`. */
export async function computeDrift(
  cwd: string,
  model: ArchitectureModel,
  baselineCommit: string | undefined,
): Promise<string[]> {
  if (!baselineCommit) {
    return [];
  }
  const mapped = model.nodes.filter((node) => node.mapping?.path);
  if (mapped.length === 0) {
    return [];
  }
  const changed = await getChangedFilesSince(cwd, baselineCommit);
  if (changed.length === 0) {
    return [];
  }
  const drifted: string[] = [];
  for (const node of mapped) {
    const path = node.mapping!.path!.replace(/\/+$/, '');
    if (changed.some((file) => file === path || file.startsWith(`${path}/`))) {
      drifted.push(node.id);
    }
  }
  return drifted;
}
