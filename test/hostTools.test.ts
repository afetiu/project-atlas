import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  codegenTools,
  editTool,
  globTool,
  grepTool,
  readTool,
  writeTool,
} from '../src/extension/ai/tools/hostTools';
import { globToRegExp } from '../src/extension/ai/tools/fsScan';

function withWorkspace(fn: (root: string, outside: string) => Promise<void> | void): Promise<void> | void {
  const base = mkdtempSync(join(tmpdir(), 'atlas-tools-'));
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const alpha = 1;\nexport const beta = 2;\n');
  writeFileSync(join(root, 'src', 'b.md'), '# readme\nhello beta world\n');
  const done = fn(root, outside);
  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return done instanceof Promise ? done.finally(cleanup) : cleanup();
}

describe('host tools', () => {
  it('Read returns file content and respects offset/limit', () =>
    withWorkspace(async (root) => {
      const tool = readTool(root);
      const full = await tool.execute({ file_path: 'src/a.ts' });
      assert.equal(full.isError, undefined);
      assert.match(full.output, /alpha = 1/);

      const windowed = await tool.execute({ file_path: 'src/a.ts', offset: 2, limit: 1 });
      assert.match(windowed.output, /beta = 2/);
      assert.doesNotMatch(windowed.output, /alpha/);
    }));

  it('Read refuses paths outside the workspace', () =>
    withWorkspace(async (root, outside) => {
      writeFileSync(join(outside, 'secret.txt'), 'top secret');
      const tool = readTool(root);
      for (const attempt of ['../outside/secret.txt', join(outside, 'secret.txt')]) {
        const result = await tool.execute({ file_path: attempt });
        assert.equal(result.isError, true);
        assert.doesNotMatch(result.output, /top secret/);
      }
    }));

  it('Glob matches nested patterns and basename patterns', () =>
    withWorkspace(async (root) => {
      const tool = globTool(root);
      const nested = await tool.execute({ pattern: 'src/**/*.ts' });
      assert.match(nested.output, /src\/a\.ts/);
      assert.doesNotMatch(nested.output, /b\.md/);

      const basename = await tool.execute({ pattern: '*.md' });
      assert.match(basename.output, /src\/b\.md/);
    }));

  it('Grep finds matches with line numbers and honors the glob filter', () =>
    withWorkspace(async (root) => {
      const tool = grepTool(root);
      const all = await tool.execute({ pattern: 'beta' });
      assert.match(all.output, /src\/a\.ts:2/);
      assert.match(all.output, /src\/b\.md:2/);

      const filtered = await tool.execute({ pattern: 'beta', glob: '**/*.ts' });
      assert.match(filtered.output, /src\/a\.ts/);
      assert.doesNotMatch(filtered.output, /b\.md/);

      const invalid = await tool.execute({ pattern: '(' });
      assert.equal(invalid.isError, true);
    }));

  it('Write creates files (with parents) inside the workspace and records them', () =>
    withWorkspace(async (root) => {
      const touched = new Set<string>();
      const tool = writeTool(root, touched);
      const result = await tool.execute({ file_path: 'src/deep/new.ts', content: 'export {};\n' });
      assert.equal(result.isError, undefined);
      assert.equal(readFileSync(join(root, 'src', 'deep', 'new.ts'), 'utf8'), 'export {};\n');
      assert.equal(touched.size, 1);
    }));

  it('Write refuses escapes — traversal, absolute, and symlinked paths', () =>
    withWorkspace(async (root, outside) => {
      const touched = new Set<string>();
      const tool = writeTool(root, touched);
      symlinkSync(outside, join(root, 'link'));
      for (const attempt of ['../outside/evil.txt', join(outside, 'evil.txt'), 'link/evil.txt']) {
        const result = await tool.execute({ file_path: attempt, content: 'evil' });
        assert.equal(result.isError, true, `expected refusal for ${attempt}`);
        assert.match(result.output, /blocked/i);
      }
      assert.equal(touched.size, 0);
    }));

  it('Edit replaces a unique match, rejects ambiguous ones without replace_all', () =>
    withWorkspace(async (root) => {
      const touched = new Set<string>();
      const tool = editTool(root, touched);

      const unique = await tool.execute({
        file_path: 'src/a.ts',
        old_string: 'alpha = 1',
        new_string: 'alpha = 42',
      });
      assert.equal(unique.isError, undefined);
      assert.match(readFileSync(join(root, 'src', 'a.ts'), 'utf8'), /alpha = 42/);

      const ambiguous = await tool.execute({
        file_path: 'src/a.ts',
        old_string: 'export',
        new_string: 'EXPORT',
      });
      assert.equal(ambiguous.isError, true);
      assert.match(ambiguous.output, /2 times/);

      const all = await tool.execute({
        file_path: 'src/a.ts',
        old_string: 'export',
        new_string: 'EXPORT',
        replace_all: true,
      });
      assert.equal(all.isError, undefined);
      assert.doesNotMatch(readFileSync(join(root, 'src', 'a.ts'), 'utf8'), /\bexport\b/);

      const missing = await tool.execute({
        file_path: 'src/a.ts',
        old_string: 'not-in-file',
        new_string: 'x',
      });
      assert.equal(missing.isError, true);
    }));

  it('codegenTools exposes exactly the five expected tools — and no shell', () =>
    withWorkspace((root) => {
      const names = codegenTools(root, new Set()).map((tool) => tool.definition.name);
      assert.deepEqual(names, ['Read', 'Glob', 'Grep', 'Write', 'Edit']);
    }));
});

describe('globToRegExp', () => {
  it('handles **, *, ?, and {a,b}', () => {
    assert.equal(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'), true);
    assert.equal(globToRegExp('src/**/*.ts').test('src/top.ts'), true);
    assert.equal(globToRegExp('src/*.ts').test('src/a/b.ts'), false);
    assert.equal(globToRegExp('*.{ts,tsx}').test('deep/dir/x.tsx'), true);
    assert.equal(globToRegExp('file?.md').test('file1.md'), true);
    assert.equal(globToRegExp('file?.md').test('file10.md'), false);
  });
});
