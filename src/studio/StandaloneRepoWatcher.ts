/**
 * Standalone counterpart to `extension/workspace/RepoWatcher.ts`. Same
 * ignore list and debounce behavior, over Node's recursive `fs.watch`
 * instead of a VS Code `FileSystemWatcher`.
 *
 * Recursive watching isn't supported everywhere (notably some Linux/Node
 * combinations lack the recursive inotify backing) — that's degraded to "no
 * live drift refresh" via `onUnsupported` rather than crashing the server;
 * drift still recomputes on every manual action.
 */

import { watch, type FSWatcher } from 'fs';

const IGNORED =
  /(^|[/\\])(node_modules|\.git|dist|dist-test|out)([/\\]|$)|atlas\.yaml$|atlas\.layout\.yaml$|\.vsix$|\.tmp$/;

export class StandaloneRepoWatcher {
  private readonly watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    cwd: string,
    private readonly onDebouncedChange: () => void,
    onUnsupported: (message: string) => void,
    private readonly debounceMs = 6000,
  ) {
    try {
      this.watcher = watch(cwd, { recursive: true }, (_event, filename) => {
        if (filename && !IGNORED.test(filename)) {
          this.schedule();
        }
      });
    } catch (error) {
      onUnsupported(
        `Live repo watching is unavailable on this platform (${(error as Error).message}); ` +
          'drift still recomputes on manual actions.',
      );
    }
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.onDebouncedChange(), this.debounceMs);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.watcher?.close();
  }
}
