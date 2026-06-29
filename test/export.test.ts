import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMermaid, toMarkdown } from '../src/shared/export/diagram';
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
