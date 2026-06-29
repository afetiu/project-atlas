/**
 * Watches the workspace for source changes and fires a debounced callback. It
 * always watches (so drift detection stays live); whether a change triggers an
 * expensive AI re-detect is decided by the panel, gated on `atlas.autoSync`.
 *
 * Generated/irrelevant paths (atlas.yaml, node_modules, dist, .git) are ignored
 * so the watcher never reacts to its own downstream writes.
 */

import * as vscode from 'vscode';

const IGNORED = /(^|[/\\])(node_modules|\.git|dist|dist-test|out)([/\\]|$)|atlas\.yaml$|\.vsix$/;

export class RepoWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    workspaceFolder: vscode.WorkspaceFolder,
    private readonly onDebouncedChange: () => void,
    private readonly debounceMs = 6000,
  ) {
    const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const handle = (uri: vscode.Uri) => this.handle(uri);
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange(handle),
      this.watcher.onDidCreate(handle),
      this.watcher.onDidDelete(handle),
    );
  }

  private handle(uri: vscode.Uri): void {
    if (IGNORED.test(uri.fsPath)) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.onDebouncedChange(), this.debounceMs);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
