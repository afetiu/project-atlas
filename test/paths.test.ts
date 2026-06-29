import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveWithinRoot } from '../src/extension/workspace/paths';

function withTempRoot(fn: (root: string, outside: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'atlas-paths-'));
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  try {
    fn(root, outside);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('accepts a plain in-workspace path', () => {
  withTempRoot((root) => {
    assert.notEqual(resolveWithinRoot(root, 'src/index.ts'), null);
  });
});

test('rejects ../ traversal', () => {
  withTempRoot((root) => {
    assert.equal(resolveWithinRoot(root, '../outside/secret'), null);
  });
});

test('rejects an absolute path outside the root', () => {
  withTempRoot((root, outside) => {
    assert.equal(resolveWithinRoot(root, join(outside, 'secret')), null);
  });
});

test('rejects a write that would follow a symlink out of the workspace', () => {
  withTempRoot((root, outside) => {
    writeFileSync(join(outside, 'secret'), 'top secret');
    // A symlink inside the workspace pointing at an external directory.
    symlinkSync(outside, join(root, 'link'));
    // Lexically "inside", but realpath escapes — must be refused.
    assert.equal(resolveWithinRoot(root, 'link/secret'), null);
    assert.equal(resolveWithinRoot(root, 'link/new-file.txt'), null);
  });
});
