/* eslint-disable */
// Assemble the headless npm package (packages/atlas-architecture-mcp) from the
// same bundles the extension ships: run the main build, then copy the MCP
// server and CLI bundles into the package's dist/.

import { execSync } from 'child_process';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDist = join(root, 'packages', 'atlas-architecture-mcp', 'dist');

execSync('npm run build', { cwd: root, stdio: 'inherit' });
mkdirSync(pkgDist, { recursive: true });
for (const file of ['mcp-server.mjs', 'atlas-check.mjs', 'atlas-diff.mjs']) {
  copyFileSync(join(root, 'dist', file), join(pkgDist, file));
}
console.log('[atlas] npm package assembled: packages/atlas-architecture-mcp');
