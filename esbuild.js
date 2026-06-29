/* eslint-disable */
// Build script for the Atlas extension.
//
// Atlas ships two independent bundles produced from a single source tree:
//   1. The extension host bundle (Node/CommonJS) that runs inside VS Code.
//   2. The webview bundle (browser/IIFE) — a standalone React application.
//
// Keeping the build in one place makes the dual-target nature explicit and
// keeps the `shared/` layer genuinely shared between both worlds.

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  ...common,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: [
    // Provided by the host at runtime.
    'vscode',
    // ESM-only and spawns the `claude` subprocess; bundling breaks its
    // `import.meta.url` usage. Loaded at runtime via dynamic import() instead.
    '@anthropic-ai/claude-agent-sdk',
  ],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  ...common,
  entryPoints: ['src/webview/index.tsx'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  // The webview runs in a sandboxed browser context; bundle everything.
  loader: { '.css': 'css' },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

async function build() {
  if (watch) {
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('[atlas] watching for changes…');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('[atlas] build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
