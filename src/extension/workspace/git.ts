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
import { promisify } from 'util';

import { resolveWithinRoot } from './paths';

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
    // `-z` + quotePath=false keeps non-ASCII/special filenames intact (git would
    // otherwise C-quote them, breaking downstream path matching) and lets us
    // split on NUL instead of newline.
    const [{ stdout: changed }, { stdout: untracked }] = await Promise.all([
      run('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', commit], {
        cwd,
        ...BIG_BUFFER,
      }),
      run('git', ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'], {
        cwd,
        ...BIG_BUFFER,
      }),
    ]);
    const lines = `${changed}\0${untracked}`.split('\0').map((l) => l.trim());
    return lines.filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Revert the files produced by code generation:
 *  - tracked files are restored to their committed state,
 *  - newly created files are unstaged and deleted.
 * Files that resolve outside the workspace are refused outright.
 */
export async function revertFiles(cwd: string, files: string[]): Promise<void> {
  for (const file of files) {
    const absolute = resolveWithinRoot(cwd, file);
    if (!absolute) {
      // Never touch anything outside the workspace, whatever the agent named.
      continue;
    }
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
    const contained = touchedFiles
      .map((file) => resolveWithinRoot(cwd, file))
      .filter((p): p is string => p !== null);
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

export interface FileHistoryEntry {
  sha: string;
  /** ISO-ish committer date. */
  date: string;
  summary: string;
}

/** Commit history of one file, newest first. */
export async function getFileHistory(cwd: string, file: string): Promise<FileHistoryEntry[]> {
  try {
    const { stdout } = await run(
      'git',
      ['log', '--format=%H%x1f%ci%x1f%s', '--follow', '--', file],
      { cwd, ...BIG_BUFFER },
    );
    return stdout
      .split('\n')
      .filter((line) => line.includes('\x1f'))
      .map((line) => {
        const [sha, date, summary] = line.split('\x1f');
        return { sha, date, summary: summary ?? '' };
      });
  } catch {
    return [];
  }
}

/** A file's content at a specific commit, or null when absent there. */
export async function getFileAtCommit(cwd: string, sha: string, file: string): Promise<string | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return null; // shas only — never let arbitrary strings reach git show
  }
  try {
    const { stdout } = await run('git', ['show', `${sha}:${file}`], { cwd, ...BIG_BUFFER });
    return stdout;
  } catch {
    return null;
  }
}
