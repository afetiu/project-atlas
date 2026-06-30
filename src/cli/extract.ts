/**
 * `atlas extract` — derive an architecture map from a real codebase's import
 * graph, with no AI and no network. Proves the map is grounded in the code:
 * components are directories of source, dependencies are real imports.
 *
 *   node dist/atlas-extract.mjs [dir] [--root=src] [--depth=2] [--out=atlas.yaml]
 *
 * With --out it writes the model; otherwise it prints it to stdout.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { isAbsolute, join, relative } from 'path';

import { extractArchitecture, type SourceFile } from '../shared/extract/staticExtract';
import { serializeLayout, serializeModel } from '../shared/serialization/yaml';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'dist-test', 'out', 'build', 'coverage']);
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, root: string, acc: SourceFile[]): void {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry) || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, root, acc);
    } else if (SOURCE_RE.test(entry) && !entry.endsWith('.d.ts') && !/\.(test|spec)\./.test(entry)) {
      acc.push({ path: relative(root, full).replace(/\\/g, '/'), content: readFileSync(full, 'utf8') });
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? process.cwd();
  const root = (args.find((a) => a.startsWith('--root='))?.slice('--root='.length)) ?? 'src';
  const depth = Number(args.find((a) => a.startsWith('--depth='))?.slice('--depth='.length)) || 2;
  const out = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);

  const files: SourceFile[] = [];
  try {
    walk(join(dir, root), dir, files);
  } catch (error) {
    console.error(`atlas extract: could not read ${join(dir, root)} — ${(error as Error).message}`);
    process.exit(2);
  }

  const model = extractArchitecture(files, { sourceRoot: root, depth });
  const yaml = serializeModel(model);

  if (out) {
    const target = isAbsolute(out) ? out : join(dir, out);
    writeFileSync(target, yaml);
    // Persist the cartographic positions alongside, so opening the map shows the
    // derived layout instead of falling back to a generic auto-layout.
    if (/atlas\.ya?ml$/.test(target)) {
      writeFileSync(target.replace(/atlas\.ya?ml$/, 'atlas.layout.yaml'), serializeLayout(model));
    }
    console.error(
      `atlas extract: ${model.nodes.length} components, ${model.edges.length} dependencies, ${model.groups.length} contexts → ${out}`,
    );
  } else {
    process.stdout.write(yaml);
  }
}

main();
