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
  AtlasParseError,
  deserializeModel,
  serializeModel,
} from '../../shared/serialization/yaml';
import { createEmptyModel, type ArchitectureModel } from '../../shared/model/types';

export const ATLAS_FILE_NAME = 'atlas.yaml';

export interface ReadResult {
  model: ArchitectureModel;
  /** Present when the file exists but could not be parsed. */
  error?: string;
}

export class AtlasFileService implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Last text we wrote, used to ignore our own change notifications. */
  private lastWrittenText: string | undefined;

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
      return { model: deserializeModel(text) };
    } catch (error) {
      const message =
        error instanceof AtlasParseError ? error.message : 'Failed to read atlas.yaml.';
      return { model: createEmptyModel(), error: message };
    }
  }

  /** Serialize and persist a model, skipping the write if nothing changed. */
  async write(model: ArchitectureModel): Promise<void> {
    const text = serializeModel(model);
    if (text === this.lastWrittenText) {
      return;
    }
    this.lastWrittenText = text;
    await vscode.workspace.fs.writeFile(this.fileUri, new TextEncoder().encode(text));
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
