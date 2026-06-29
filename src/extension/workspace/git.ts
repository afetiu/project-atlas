/**
 * Captures the working-tree diff after code generation, so the user can review
 * exactly what the AI changed.
 *
 * `git add -N` (intent-to-add) is used first so that newly created files show
 * up in `git diff` as additions without actually staging their contents — a
 * non-destructive way to include untracked files in the review.
 */

import { exec } from 'child_process';
import { rm } from 'fs/promises';
import { promisify } from 'util';

const run = promisify(exec);
const MAX_DIFF_CHARS = 200_000;

/**
 * Revert a specific set of files produced by code generation:
 *  - tracked files are restored to their committed state,
 *  - newly created files are unstaged and deleted.
 * Scoped to exactly the files the agent touched, so unrelated work is safe.
 */
export async function revertFiles(cwd: string, files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await run(`git ls-files --error-unmatch -- ${quote(file)}`, { cwd });
      // Tracked → restore committed contents.
      await run(`git checkout HEAD -- ${quote(file)}`, { cwd });
    } catch {
      // Untracked → unstage any intent-to-add and remove the file.
      await run(`git reset -q -- ${quote(file)}`, { cwd }).catch(() => undefined);
      await rm(file, { force: true }).catch(() => undefined);
    }
  }
}

function quote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export async function getWorkingTreeDiff(cwd: string): Promise<string> {
  try {
    await run('git add -N -- .', { cwd, maxBuffer: 1024 * 1024 * 32 }).catch(() => undefined);
    const { stdout } = await run('git --no-pager diff', {
      cwd,
      maxBuffer: 1024 * 1024 * 32,
    });
    if (stdout.length > MAX_DIFF_CHARS) {
      return `${stdout.slice(0, MAX_DIFF_CHARS)}\n… diff truncated …`;
    }
    return stdout;
  } catch {
    // Not a git repo, or git unavailable — degrade gracefully.
    return '';
  }
}
