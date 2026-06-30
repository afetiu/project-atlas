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

/** @type {import('esbuild').BuildOptions} */
const mcpConfig = {
  ...common,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp-server.mjs',
  platform: 'node',
  // ESM output keeps the MCP SDK's import.meta.url usage valid, and Node runs
  // the .mjs directly when Claude Code launches it.
  format: 'esm',
  // Bundled CJS dependencies (e.g. ajv) call require() for Node built-ins.
  // Recreate a real require/__dirname in the ESM output so they resolve.
  banner: {
    js: [
      "import { createRequire as __atlasCreateRequire } from 'module';",
      "import { fileURLToPath as __atlasFileURLToPath } from 'url';",
      "import { dirname as __atlasDirname } from 'path';",
      'const require = __atlasCreateRequire(import.meta.url);',
      'const __filename = __atlasFileURLToPath(import.meta.url);',
      'const __dirname = __atlasDirname(__filename);',
    ].join('\n'),
  },
};

/** @type {import('esbuild').BuildOptions} */
const cliConfig = {
  ...common,
  entryPoints: ['src/cli/check.ts'],
  outfile: 'dist/atlas-check.mjs',
  platform: 'node',
  format: 'esm',
  banner: mcpConfig.banner, // same require()/__dirname shim for bundled CJS deps
};

/** @type {import('esbuild').BuildOptions} */
const diffCliConfig = {
  ...cliConfig,
  entryPoints: ['src/cli/diff.ts'],
  outfile: 'dist/atlas-diff.mjs',
};

async function build() {
  const configs = [extensionConfig, webviewConfig, mcpConfig, cliConfig, diffCliConfig];
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[atlas] watching for changes…');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log('[atlas] build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
