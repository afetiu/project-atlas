/* eslint-disable */
// Lightweight test runner: bundle each `test/*.test.ts` with esbuild (reusing
// the dependency we already have), then run them with Node's built-in test
// runner. Keeps the test toolchain dependency-free.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const OUT = 'dist-test';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const entries = readdirSync('test')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => join('test', f));

await esbuild.build({
  entryPoints: entries,
  outdir: OUT,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: 'inline',
  logLevel: 'warning',
  // Extension-host modules import `vscode`, which only exists inside VS Code.
  // Tests get a seedable stub instead.
  alias: { vscode: './test/helpers/vscodeStub.ts' },
});

const testFiles = readdirSync(OUT)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(OUT, f));

const result = spawnSync('node', ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
