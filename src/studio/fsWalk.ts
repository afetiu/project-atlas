/**
 * Plain-`fs` directory walking for the standalone session — the counterpart
 * to `vscode.workspace.findFiles`, used for "Map from code" (source files)
 * and the docs catalog (Markdown files). Mirrors the exclude list `src/cli/
 * extract.ts` already uses for the same job outside VS Code.
 */

import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-test',
  'out',
  'build',
  'coverage',
  '.next',
  '.git',
]);

export interface WalkedFile {
  /** Repo-relative, POSIX-separated path. */
  path: string;
  absolute: string;
}

/** Recursively list files under `<cwd>/<root>` matching `pattern`, skipping generated/vendor/hidden dirs. */
export async function walkFiles(
  cwd: string,
  root: string,
  pattern: RegExp,
  limit = 5000,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  await walkDir(join(cwd, root), cwd, pattern, out, limit);
  return out;
}

async function walkDir(
  dir: string,
  cwd: string,
  pattern: RegExp,
  out: WalkedFile[],
  limit: number,
): Promise<void> {
  if (out.length >= limit) {
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist or is unreadable
  }
  for (const entry of entries) {
    if (out.length >= limit) {
      return;
    }
    if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, cwd, pattern, out, limit);
    } else if (entry.isFile() && pattern.test(entry.name)) {
      out.push({ path: relative(cwd, full).replace(/\\/g, '/'), absolute: full });
    }
  }
}

/** Read each file's text, skipping anything larger than `maxBytes` (not documentation/source-sized). */
export async function readTextFiles(
  files: WalkedFile[],
  maxBytes = 512 * 1024,
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    try {
      const buf = await readFile(file.absolute);
      if (buf.byteLength > maxBytes) {
        continue;
      }
      results.push({ path: file.path, content: buf.toString('utf8') });
    } catch {
      // unreadable — skip
    }
  }
  return results;
}
