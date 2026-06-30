import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  toMermaid,
  toMarkdown,
  toSvg,
  toArchitectureDoc,
  updateReadmeBlock,
} from '../src/shared/export/diagram';
import type { ArchitectureModel } from '../src/shared/model/types';
const model: ArchitectureModel = { version:1, groups:[{id:'core',name:'Core'}],
  nodes:[
    {id:'web',name:'Web',type:'frontend',description:'ui',position:{x:0,y:0},groupId:'core'},
    {id:'db',name:'DB',type:'database',description:'store',position:{x:0,y:0}},
  ],
  edges:[{id:'e',source:'web',target:'db',protocol:'http'}] };
test('mermaid has flowchart, subgraph, and edge', () => {
  const m = toMermaid(model);
  assert.ok(m.startsWith('flowchart LR'));
  assert.ok(m.includes('subgraph core'));
  assert.ok(/web -->\|HTTP\| db/.test(m));
});
test('markdown embeds mermaid and a component table', () => {
  const md = toMarkdown(model);
  assert.ok(md.includes('```mermaid'));
  assert.ok(md.includes('| Web | Frontend |'));
});
test('svg dark theme uses a dark background', () => {
  const light = toSvg(model, 'light');
  const dark = toSvg(model, 'dark');
  assert.ok(light.includes('fill="#ffffff"'));
  assert.ok(dark.includes('fill="#0f1117"'));
  assert.ok(!dark.includes('fill="#ffffff"'));
});

test('architecture doc includes health, catalog by context, and findings', () => {
  const doc = toArchitectureDoc(model);
  assert.ok(/Health: [A-F] \(\d+\/100\)/.test(doc), 'has a health line');
  assert.ok(doc.includes('```mermaid'));
  assert.ok(doc.includes('### Core'), 'groups components by context');
  assert.ok(doc.includes('| Web |'), 'lists components');
  assert.ok(doc.includes('Generated from'), 'marks itself as generated');
});

test('updateReadmeBlock inserts a block, then replaces it idempotently', () => {
  const first = updateReadmeBlock('# My Project\n\nHello.\n', model);
  assert.ok(first.includes('<!-- atlas:start -->'));
  assert.ok(first.includes('<!-- atlas:end -->'));
  assert.ok(first.includes('```mermaid'));
  assert.ok(first.startsWith('# My Project'));
  // Re-running replaces the block rather than appending a second one.
  const second = updateReadmeBlock(first, model);
  assert.equal(second.match(/atlas:start/g)?.length, 1);
});

test('svg is well-formed, names nodes, groups, and escapes markup', () => {
  const tricky: ArchitectureModel = {
    version: 1,
    groups: [{ id: 'core', name: 'Core & More' }],
    nodes: [
      { id: 'web', name: '<Web>', type: 'frontend', description: '', position: { x: 0, y: 0 }, groupId: 'core' },
      { id: 'db', name: 'DB', type: 'database', description: '', position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'web', target: 'db', protocol: 'http' }],
  };
  const svg = toSvg(tricky);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('&lt;Web&gt;'), 'escapes node names');
  assert.ok(svg.includes('Core &amp; More'), 'escapes group names');
  assert.ok(svg.includes('marker-end="url(#arrow)"'), 'draws directed edges');
  // No stored positions → auto-layout must still produce a finite canvas.
  assert.ok(/width="\d+"/.test(svg));
});
