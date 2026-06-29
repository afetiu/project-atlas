/**
 * Filesystem containment, symlink-aware.
 *
 * A purely lexical `resolve(root, target).startsWith(root)` check is bypassable
 * when the repo contains a symlink pointing outside itself (common: monorepo
 * package links, `node_modules/.bin`, vendored deps). A write or read through
 * that link lands outside the workspace while still looking "inside" by string.
 *
 * `resolveWithinRoot` defends against that by resolving the real path of the
 * target's nearest existing ancestor before comparing. It is the single helper
 * every agent/model-controlled path should pass through: the codegen write
 * guard, revert, and `open:file`.
 */

import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, resolve, sep } from 'path';

/**
 * Resolve `target` (relative to `root`, or absolute) and return its absolute
 * path only if it is genuinely inside `root` after symlinks are resolved.
 * Returns `null` for anything that escapes — callers must treat null as "refuse".
 */
export function resolveWithinRoot(root: string, target: string): string | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(root));
  } catch {
    // Root itself is unreadable — refuse rather than guess.
    return null;
  }

  const absolute = isAbsolute(target) ? resolve(target) : resolve(realRoot, target);

  // Realpath the nearest existing ancestor so a symlinked intermediate segment
  // can't smuggle the final path out of the workspace.
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      break; // reached the filesystem root
    }
    existing = parent;
  }

  let realExisting: string;
  try {
    realExisting = realpathSync(existing);
  } catch {
    return null;
  }

  // The resolved ancestor plus the not-yet-existing tail must stay inside root.
  const tail = absolute.slice(existing.length);
  const candidate = resolve(realExisting + tail);
  if (candidate === realRoot || candidate.startsWith(realRoot + sep)) {
    return candidate;
  }
  return null;
}

/** Convenience boolean form. */
export function isWithinRoot(root: string, target: string): boolean {
  return resolveWithinRoot(root, target) !== null;
}
