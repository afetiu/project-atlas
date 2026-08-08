/**
 * Standalone counterpart to `extension/workspace/BaselineStore.ts`. VS Code's
 * per-workspace `Memento` becomes a small JSON file under the user's home
 * directory, keyed by a hash of the repo path — so it lives outside the repo
 * (nothing to gitignore) and survives across `atlas-studio` restarts, the
 * same way workspace state survives a VS Code reload.
 */

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { ArchitectureModel } from '../shared/model/types';

interface StoredState {
  baseline?: ArchitectureModel;
  commit?: string;
}

export class StandaloneBaselineStore {
  private readonly file: string;
  private state: StoredState;

  constructor(cwd: string, stateDir: string = join(homedir(), '.atlas', 'studio-state')) {
    const key = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
    mkdirSync(stateDir, { recursive: true });
    this.file = join(stateDir, `${key}.json`);
    this.state = this.load();
  }

  private load(): StoredState {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StoredState;
    } catch {
      return {}; // first run for this repo — nothing persisted yet
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.state));
  }

  get(): ArchitectureModel | undefined {
    return this.state.baseline;
  }

  async set(model: ArchitectureModel): Promise<void> {
    this.state.baseline = model;
    this.persist();
  }

  /** The git commit the architecture was last *detected* at (see BaselineStore). */
  getCommit(): string | undefined {
    return this.state.commit;
  }

  async setCommit(commit: string | undefined): Promise<void> {
    this.state.commit = commit;
    this.persist();
  }
}
