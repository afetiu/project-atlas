import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseMarkdown,
  parseInlines,
  extractTitle,
  extractHeadings,
  excerptOf,
  plainText,
} from '../src/shared/docs/markdown';
import { groupDocs, matchDocsToComponents, type DocMeta } from '../src/shared/docs/catalog';
import type { ArchitectureModel } from '../src/shared/model/types';

test('parses headings, paragraphs, code fences, lists, quotes, tables, rules', () => {
  const md = [
    '# Title',
    '',
    'A paragraph with **bold**, *italic*, `code`, and a [link](https://x.dev).',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '> wisdom here',
    '',
    '---',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
  ].join('\n');
  const blocks = parseMarkdown(md);
  const kinds = blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'code', 'list', 'list', 'quote', 'hr', 'table']);
  const code = blocks[2] as Extract<(typeof blocks)[number], { kind: 'code' }>;
  assert.equal(code.lang, 'ts');
  assert.equal(code.text, 'const a = 1;');
  const table = blocks[7] as Extract<(typeof blocks)[number], { kind: 'table' }>;
  assert.equal(plainText(table.header[0]), 'A');
  assert.equal(plainText(table.rows[0][1]), '2');
});

test('inline parsing nests and orders correctly', () => {
  const inlines = parseInlines('a **bold `x`** then [see](docs/guide.md) end');
  assert.equal(inlines[0].kind, 'text');
  assert.equal(inlines[1].kind, 'bold');
  const link = inlines.find((n) => n.kind === 'link') as Extract<(typeof inlines)[number], { kind: 'link' }>;
  assert.equal(link.href, 'docs/guide.md');
});

test('title, headings (skipping code fences), and excerpt', () => {
  const md = '# My Doc\n\nFirst para here.\n\n```\n# not a heading\n```\n\n## Section';
  assert.equal(extractTitle(md, 'fallback'), 'My Doc');
  assert.deepEqual(extractHeadings(md).map((h) => h.text), ['My Doc', 'Section']);
  assert.equal(excerptOf(md), 'First para here.');
  assert.equal(extractTitle('no headings at all', 'readme'), 'readme');
});

const doc = (path: string): DocMeta => ({ path, title: path, excerpt: '', headings: [] });

test('catalog groups by top directory with Overview first', () => {
  const sections = groupDocs([doc('docs/a.md'), doc('README.md'), doc('packages/x/guide.md')]);
  assert.deepEqual(sections.map((s) => s.name), ['Overview', 'docs', 'packages']);
});

test('docs match the deepest component whose mapping contains them', () => {
  const model: ArchitectureModel = {
    version: 1,
    nodes: [
      { id: 'svc', name: 'svc', type: 'service', description: '', position: { x: 0, y: 0 }, mapping: { path: 'src/svc' } },
      { id: 'svc-api', name: 'api', type: 'service', description: '', position: { x: 0, y: 0 }, mapping: { path: 'src/svc/api' } },
    ],
    edges: [],
    groups: [],
  };
  const matched = matchDocsToComponents([doc('src/svc/api/README.md'), doc('docs/other.md')], model);
  assert.equal(matched[0].componentId, 'svc-api'); // deepest mapping wins
  assert.equal(matched[1].componentId, undefined);
});
