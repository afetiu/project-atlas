import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertSafePath } from '../src/mcp/atlasStore';

test('accepts workspace-relative paths', () => {
  assert.doesNotThrow(() => assertSafePath('src/services/orders'));
  assert.doesNotThrow(() => assertSafePath('a/b/c.ts'));
});

test('rejects absolute paths', () => {
  assert.throws(() => assertSafePath('/etc/passwd'));
});

test('rejects paths that escape the workspace', () => {
  assert.throws(() => assertSafePath('../secrets'));
  assert.throws(() => assertSafePath('a/../../b'));
  assert.throws(() => assertSafePath('..'));
});
