/**
 * Persists the "code-synced baseline" — the architecture the code currently
 * reflects. The diff between this baseline and the live model is the set of
 * pending changes that code generation will realize.
 *
 * Stored in workspace state, keyed per workspace, so pending changes survive
 * reloads of the panel.
 */

import * as vscode from 'vscode';

import type { ArchitectureModel } from '../../shared/model/types';

export class BaselineStore {
  private readonly key: string;

  constructor(
    private readonly memento: vscode.Memento,
    workspaceFolder: vscode.WorkspaceFolder,
  ) {
    this.key = `atlas.baseline:${workspaceFolder.uri.toString()}`;
  }

  get(): ArchitectureModel | undefined {
    return this.memento.get<ArchitectureModel>(this.key);
  }

  async set(model: ArchitectureModel): Promise<void> {
    await this.memento.update(this.key, model);
  }
}
