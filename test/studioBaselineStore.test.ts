import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StandaloneBaselineStore } from '../src/studio/StandaloneBaselineStore';
import { createEmptyModel } from '../src/shared/model/types';

describe('StandaloneBaselineStore', () => {
  it('has no baseline or commit before anything is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-baseline-'));
    try {
      const store = new StandaloneBaselineStore('/some/repo', dir);
      assert.equal(store.get(), undefined);
      assert.equal(store.getCommit(), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists the baseline and commit across instances (same repo path → same file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-baseline-'));
    try {
      const model = {
        ...createEmptyModel(),
        nodes: [{ id: 'a', name: 'A', type: 'service' as const, description: '', position: { x: 0, y: 0 } }],
      };
      const first = new StandaloneBaselineStore('/some/repo', dir);
      await first.set(model);
      await first.setCommit('abc123');

      const second = new StandaloneBaselineStore('/some/repo', dir);
      assert.deepEqual(second.get(), model);
      assert.equal(second.getCommit(), 'abc123');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('different repo paths get independent state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-baseline-'));
    try {
      const storeA = new StandaloneBaselineStore('/repo/a', dir);
      const storeB = new StandaloneBaselineStore('/repo/b', dir);
      await storeA.setCommit('from-a');
      assert.equal(storeB.getCommit(), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
