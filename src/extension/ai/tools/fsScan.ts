/**
 * Bounded workspace scanning shared by the Glob and Grep tools.
 *
 * The walk is deliberately conservative: it skips dependency/VCS directories,
 * never follows directory symlinks (a link out of the repo must not widen the
 * scan), and caps the number of visited entries so a pathological workspace
 * cannot wedge the loop.
 */

import { lstatSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-test', 'out', '.next']);
const MAX_ENTRIES = 50_000;

/** Relative (posix-style) paths of all regular files under `root`, bounded. */
export function listWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const stack: string[] = [root];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_ENTRIES) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip, don't fail the scan
    }
    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) {
        break;
      }
      visited += 1;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push(full);
        }
      } else if (entry.isFile()) {
        files.push(relative(root, full).split(sep).join('/'));
      } else if (entry.isSymbolicLink()) {
        // Only include symlinks that are regular files; never traverse
        // symlinked directories (they can point outside the workspace).
        try {
          if (lstatSync(full).isFile()) {
            files.push(relative(root, full).split(sep).join('/'));
          }
        } catch {
          // broken link — ignore
        }
      }
    }
  }
  return files.sort();
}

/**
 * Convert a glob pattern (`**`, `*`, `?`, `{a,b}`) into a RegExp over
 * posix-style relative paths. Patterns without a slash match basenames
 * anywhere in the tree (like common glob tools).
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.includes('/') ? pattern.replace(/^\.\//, '') : `**/${pattern}`;
  let regex = '';
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        // `**/` matches zero or more directories; bare `**` matches anything.
        if (normalized[i + 2] === '/') {
          regex += '(?:[^/]+/)*';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      regex += '[^/]';
      i += 1;
    } else if (char === '{') {
      const close = normalized.indexOf('}', i);
      if (close === -1) {
        regex += '\\{';
        i += 1;
      } else {
        const options = normalized
          .slice(i + 1, close)
          .split(',')
          .map((option) => option.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
        regex += `(?:${options.join('|')})`;
        i = close + 1;
      }
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`);
}
