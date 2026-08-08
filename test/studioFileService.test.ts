import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AtlasWriteConflictError, StandaloneFileService } from '../src/studio/StandaloneFileService';
import { createEmptyModel } from '../src/shared/model/types';

describe('StandaloneFileService', () => {
  it('reads an empty model when atlas.yaml does not exist yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-fs-'));
    try {
      const service = new StandaloneFileService(dir);
      try {
        const { model, error } = await service.read();
        assert.equal(error, undefined);
        assert.deepEqual(model.nodes, []);
      } finally {
        service.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a write through a fresh read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-fs-'));
    try {
      const service = new StandaloneFileService(dir);
      try {
        const model = {
          ...createEmptyModel(),
          nodes: [{ id: 'a', name: 'A', type: 'service' as const, description: '', position: { x: 0, y: 0 } }],
        };
        await service.write(model);

        const reread = new StandaloneFileService(dir);
        try {
          const { model: loaded } = await reread.read();
          assert.equal(loaded.nodes.length, 1);
          assert.equal(loaded.nodes[0].id, 'a');
        } finally {
          reread.dispose();
        }
      } finally {
        service.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws AtlasWriteConflictError when an unread external edit would be clobbered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-fs-'));
    try {
      const service = new StandaloneFileService(dir);
      const model = { ...createEmptyModel(), nodes: [{ id: 'a', name: 'A', type: 'service' as const, description: '', position: { x: 0, y: 0 } }] };
      await service.write(model);

      // Stop the watcher so this service can never learn about the next
      // external edit itself — isolates conflict detection from fs.watch
      // timing (the watcher legitimately absorbing an external change before
      // the next write() runs is correct behavior, not a race to test here).
      service.dispose();

      // Someone else changes atlas.yaml on disk without this service's knowledge.
      writeFileSync(join(dir, 'atlas.yaml'), 'version: 1\nnodes: []\nedges: []\ngroups: []\n');

      const conflicting = {
        ...createEmptyModel(),
        nodes: [{ id: 'b', name: 'B', type: 'service' as const, description: '', position: { x: 10, y: 10 } }],
      };
      await assert.rejects(service.write(conflicting), AtlasWriteConflictError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
