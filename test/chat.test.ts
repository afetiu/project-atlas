import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseChatReply, stripProposalBlock, MAX_PROPOSAL_NODES } from '../src/shared/ai/chat';

test('parses prose with no proposal', () => {
  const res = parseChatReply('Just an answer, no changes.');
  assert.equal(res.reply, 'Just an answer, no changes.');
  assert.equal(res.proposal ?? null, null);
});

test('extracts a trailing proposal and strips it from the prose', () => {
  const text =
    'Here is the plan.\n```atlas-proposal\n{"summary":"Add cache","nodes":[{"id":"c","name":"Cache","type":"cache"}],"edges":[]}\n```';
  const res = parseChatReply(text);
  assert.equal(res.reply, 'Here is the plan.');
  assert.equal(res.proposal?.summary, 'Add cache');
  assert.equal(res.proposal?.nodes.length, 1);
});

test('when several fences exist, the last well-formed one wins and all are stripped', () => {
  const text = [
    'Draft then final.',
    '```atlas-proposal',
    '{"summary":"draft","nodes":[]}', // empty nodes → not usable
    '```',
    'and the real one:',
    '```atlas-proposal',
    '{"summary":"final","nodes":[{"id":"x","name":"X","type":"service"}],"edges":[]}',
    '```',
  ].join('\n');
  const res = parseChatReply(text);
  assert.equal(res.proposal?.summary, 'final');
  assert.equal(res.reply.includes('atlas-proposal'), false);
  assert.equal(res.reply.includes('{'), false);
});

test('malformed JSON in the fence is treated as prose, not a crash', () => {
  const text = 'Oops.\n```atlas-proposal\n{not json,,}\n```';
  const res = parseChatReply(text);
  assert.equal(res.proposal ?? null, null);
  assert.equal(res.reply, 'Oops.');
});

test('caps a runaway proposal at MAX_PROPOSAL_NODES', () => {
  const nodes = Array.from({ length: MAX_PROPOSAL_NODES + 50 }, (_, i) => ({
    id: `n${i}`,
    name: `N${i}`,
    type: 'service',
  }));
  const text = '```atlas-proposal\n' + JSON.stringify({ summary: 's', nodes, edges: [] }) + '\n```';
  const res = parseChatReply(text);
  assert.equal(res.proposal?.nodes.length, MAX_PROPOSAL_NODES);
});

test('stripProposalBlock hides a partial streaming fence', () => {
  assert.equal(stripProposalBlock('Thinking...\n```atlas-proposal\n{"sum'), 'Thinking...');
});
