/**
 * Optional auto-sync: watches the workspace for source changes and, when the
 * `atlas.autoSync` setting is enabled, triggers a debounced callback (the panel
 * re-detects). Disabled by default because each sync is a full AI run.
 *
 * Changes to generated/irrelevant paths (atlas.yaml, node_modules, dist, .git)
 * are ignored so the watcher never reacts to its own downstream writes.
 */

import * as vscode from 'vscode';

const IGNORED = /(^|[/\\])(node_modules|\.git|dist|dist-test|out)([/\\]|$)|atlas\.yaml$|\.vsix$/;

export class RepoWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private enabled = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly onDebouncedChange: () => void,
    private readonly debounceMs = 8000,
  ) {
    this.applySetting();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('atlas.autoSync')) {
          this.applySetting();
        }
      }),
    );
  }

  private applySetting(): void {
    const on = vscode.workspace.getConfiguration('atlas').get<boolean>('autoSync', false);
    if (on) {
      this.enable();
    } else {
      this.disable();
    }
  }

  private enable(): void {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    const pattern = new vscode.RelativePattern(this.workspaceFolder, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const handle = (uri: vscode.Uri) => this.handle(uri);
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange(handle),
      this.watcher.onDidCreate(handle),
      this.watcher.onDidDelete(handle),
    );
  }

  private disable(): void {
    this.enabled = false;
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
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
    this.disable();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
