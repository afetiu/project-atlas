import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractArchitecture, parseImports, type SourceFile } from '../src/shared/extract/staticExtract';
import { validateModel } from '../src/shared/serialization/validation';

test('parseImports finds static, dynamic, re-export and require specifiers', () => {
  const specs = parseImports(`
    import a from './a';
    import { b } from "../b/index";
    import './side-effect';
    export * from './c';
    const d = await import('./d');
    const e = require('./e');
    import x from 'external-pkg';
  `);
  assert.ok(specs.includes('./a'));
  assert.ok(specs.includes('../b/index'));
  assert.ok(specs.includes('./side-effect'));
  assert.ok(specs.includes('./c'));
  assert.ok(specs.includes('./d'));
  assert.ok(specs.includes('./e'));
  assert.ok(specs.includes('external-pkg'));
});

test('extracts components and real cross-component dependency edges', () => {
  const files: SourceFile[] = [
    { path: 'src/web/app.ts', content: `import { q } from '../core/query'; import 'external';` },
    { path: 'src/core/query.ts', content: `import { db } from '../store/conn';` },
    { path: 'src/store/conn.ts', content: `export const db = {};` },
  ];
  const model = extractArchitecture(files, { sourceRoot: 'src', depth: 1 });
  assert.equal(validateModel(model).valid, true);
  const ids = model.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['core', 'store', 'web']);
  // web → core (real import), core → store (real import); no edge to external.
  const edges = model.edges.map((e) => `${e.source}->${e.target}`).sort();
  assert.deepEqual(edges, ['core->store', 'web->core']);
  // the "store" component is inferred as a database; mappings point at the code.
  assert.equal(model.nodes.find((n) => n.id === 'store')!.type, 'database');
  assert.equal(model.nodes.find((n) => n.id === 'web')!.type, 'frontend');
  assert.equal(model.nodes.find((n) => n.id === 'web')!.mapping?.path, 'src/web');
});

test('groups components into contexts at depth 2', () => {
  const files: SourceFile[] = [
    { path: 'src/extension/ai/agent.ts', content: `import '../workspace/git';` },
    { path: 'src/extension/workspace/git.ts', content: `export const x = 1;` },
    { path: 'src/shared/model/types.ts', content: `export type T = 1;` },
  ];
  const model = extractArchitecture(files, { sourceRoot: 'src', depth: 2 });
  assert.ok(model.groups.some((g) => g.name === 'Extension'));
  assert.ok(model.groups.some((g) => g.name === 'Shared'));
  // extension/ai depends on extension/workspace.
  assert.ok(model.edges.some((e) => e.source === 'extension-ai' && e.target === 'extension-workspace'));
});
