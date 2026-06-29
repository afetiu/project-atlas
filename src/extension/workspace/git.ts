/**
 * Git helpers for the code-generation flow: capturing the working-tree diff and
 * reverting exactly the files the agent produced.
 *
 * Safety properties:
 *  - All git calls use `execFile` with argument arrays (no shell), so
 *    agent-controlled filenames can never be interpreted as shell.
 *  - Revert is confined to the workspace: a path that resolves outside `cwd`
 *    is refused, so a stray absolute path from the agent can never delete an
 *    arbitrary file.
 */

import { execFile } from 'child_process';
import { rm } from 'fs/promises';
import { resolve, sep } from 'path';
import { promisify } from 'util';

const run = promisify(execFile);
const MAX_DIFF_CHARS = 200_000;
const BIG_BUFFER = { maxBuffer: 1024 * 1024 * 32 };

/** The current HEAD commit hash, or undefined when not a git repo. */
export async function getHeadCommit(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Workspace-relative paths changed since `commit` — committed and uncommitted
 * modifications plus untracked files. Used for drift detection.
 */
export async function getChangedFilesSince(cwd: string, commit: string): Promise<string[]> {
  try {
    const [{ stdout: changed }, { stdout: untracked }] = await Promise.all([
      run('git', ['diff', '--name-only', commit], { cwd, ...BIG_BUFFER }),
      run('git', ['ls-files', '--others', '--exclude-standard'], { cwd, ...BIG_BUFFER }),
    ]);
    const lines = `${changed}\n${untracked}`.split('\n').map((l) => l.trim());
    return lines.filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** True when `target` resolves to a path inside `root`. */
function isInside(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep);
}

/**
 * Revert the files produced by code generation:
 *  - tracked files are restored to their committed state,
 *  - newly created files are unstaged and deleted.
 * Files that resolve outside the workspace are refused outright.
 */
export async function revertFiles(cwd: string, files: string[]): Promise<void> {
  for (const file of files) {
    if (!isInside(cwd, file)) {
      // Never touch anything outside the workspace, whatever the agent named.
      continue;
    }
    const absolute = resolve(cwd, file);
    try {
      await run('git', ['ls-files', '--error-unmatch', '--', absolute], { cwd });
      await run('git', ['checkout', 'HEAD', '--', absolute], { cwd }); // tracked → restore
    } catch {
      await run('git', ['reset', '-q', '--', absolute], { cwd }).catch(() => undefined);
      await rm(absolute, { force: true }).catch(() => undefined); // untracked → remove
    }
  }
}

/**
 * Capture the working-tree diff. Intent-to-add is scoped to the files the agent
 * touched (when known) rather than the whole repo, so we don't pollute the
 * user's index with unrelated untracked files.
 */
export async function getWorkingTreeDiff(cwd: string, touchedFiles: string[] = []): Promise<string> {
  try {
    const contained = touchedFiles.filter((file) => isInside(cwd, file)).map((file) => resolve(cwd, file));
    if (contained.length > 0) {
      await run('git', ['add', '-N', '--', ...contained], { cwd, ...BIG_BUFFER }).catch(() => undefined);
    }
    const { stdout } = await run('git', ['--no-pager', 'diff'], { cwd, ...BIG_BUFFER });
    return stdout.length > MAX_DIFF_CHARS
      ? `${stdout.slice(0, MAX_DIFF_CHARS)}\n… diff truncated …`
      : stdout;
  } catch {
    return ''; // not a git repo, or git unavailable
  }
}
