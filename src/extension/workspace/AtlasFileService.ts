/**
 * Owns all interaction with `atlas.yaml` at the workspace root.
 *
 * Responsibilities:
 *   - locate / create the file
 *   - read it into a domain model
 *   - write a domain model back out
 *   - watch for external edits and notify listeners
 *
 * Crucially, it suppresses the file-change echo caused by its own writes, so
 * the canvas ⇄ file synchronization never loops.
 */

import * as vscode from 'vscode';

import {
  applyLayout,
  AtlasParseError,
  deserializeModel,
  serializeLayout,
  serializeModel,
} from '../../shared/serialization/yaml';
import {
  CURRENT_MODEL_VERSION,
  createEmptyModel,
  type ArchitectureModel,
} from '../../shared/model/types';

export const ATLAS_FILE_NAME = 'atlas.yaml';
export const ATLAS_LAYOUT_FILE_NAME = 'atlas.layout.yaml';

export interface ReadResult {
  model: ArchitectureModel;
  /** Present when the file exists but could not be parsed. */
  error?: string;
  /** True when the file was written by a newer Atlas and must not be overwritten. */
  readOnly?: boolean;
}

export class AtlasFileService implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Last logical text we wrote, used to ignore our own change notifications. */
  private lastWrittenText: string | undefined;
  /** Last layout-sidecar text we wrote. */
  private lastWrittenLayout: string | undefined;

  /** Serializes write() calls so they never interleave. */
  private writeChain: Promise<void> = Promise.resolve();

  /** Set when the on-disk file is a newer schema than this build understands. */
  private futureVersion = false;

  /** Fired when `atlas.yaml` changes on disk due to an external edit. */
  readonly onDidChangeExternally = this.changeEmitter.event;

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {
    const pattern = new vscode.RelativePattern(workspaceFolder, ATLAS_FILE_NAME);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handleChange = () => this.handleFileSystemEvent();
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange(handleChange),
      this.watcher.onDidCreate(handleChange),
      this.watcher.onDidDelete(handleChange),
      this.changeEmitter,
    );
  }

  get fileUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceFolder.uri, ATLAS_FILE_NAME);
  }

  get layoutUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceFolder.uri, ATLAS_LAYOUT_FILE_NAME);
  }

  /** Read and parse `atlas.yaml`, returning an empty model when absent. */
  async read(): Promise<ReadResult> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(this.fileUri);
    } catch {
      // File does not exist yet — a valid starting state.
      return { model: createEmptyModel() };
    }

    const text = new TextDecoder().decode(bytes);
    try {
      const logical = deserializeModel(text);
      this.futureVersion = logical.version > CURRENT_MODEL_VERSION;
      const model = applyLayout(logical, await this.readLayoutText());
      return this.futureVersion ? { model, readOnly: true } : { model };
    } catch (error) {
      const message =
        error instanceof AtlasParseError ? error.message : 'Failed to read atlas.yaml.';
      return { model: createEmptyModel(), error: message };
    }
  }

  private async readLayoutText(): Promise<string> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.layoutUri));
    } catch {
      return ''; // no sidecar yet — applyLayout falls back to auto-layout
    }
  }

  /**
   * Serialize and persist a model. Writes are:
   *  - serialized through a promise chain (no interleaving),
   *  - atomic (write a temp file, then rename over the target),
   *  - echo-marked only *after* success, so a failed write can't poison the
   *    skip check or the watcher's echo suppression.
   */
  write(model: ArchitectureModel): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.writeNow(model)).catch(() => undefined);
    return this.writeChain;
  }

  private async writeNow(model: ArchitectureModel): Promise<void> {
    if (this.futureVersion) {
      // Refuse to overwrite a file written by a newer Atlas — doing so would
      // strip fields this build doesn't understand.
      return;
    }
    // The logical model (atlas.yaml) only changes on architectural edits; the
    // layout sidecar absorbs position-only changes (e.g. dragging), keeping the
    // source-of-truth file stable and merge-clean.
    const logicalText = serializeModel(model);
    if (logicalText !== this.lastWrittenText) {
      await this.writeAtomic(this.fileUri, logicalText);
      this.lastWrittenText = logicalText;
    }
    const layoutText = serializeLayout(model);
    if (layoutText !== this.lastWrittenLayout) {
      await this.writeAtomic(this.layoutUri, layoutText);
      this.lastWrittenLayout = layoutText;
    }
  }

  private async writeAtomic(uri: vscode.Uri, text: string): Promise<void> {
    const tempUri = uri.with({ path: `${uri.path}.tmp` });
    await vscode.workspace.fs.writeFile(tempUri, new TextEncoder().encode(text));
    await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
  }

  private async handleFileSystemEvent(): Promise<void> {
    // Compare on-disk content against our last write to filter out the echo
    // from our own `write()` calls.
    let currentText: string | undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      currentText = new TextDecoder().decode(bytes);
    } catch {
      currentText = undefined; // deleted
    }

    if (currentText !== undefined && currentText === this.lastWrittenText) {
      return; // our own write echoed back — ignore.
    }

    this.lastWrittenText = currentText;
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
