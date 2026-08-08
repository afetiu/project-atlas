/**
 * Standalone counterpart to `extension/workspace/AtlasFileService.ts`. Same
 * contract and the same safety properties — atomic writes, conflict
 * detection against unseen external edits, and echo suppression so this
 * service's own writes don't re-trigger its own watcher — reimplemented over
 * plain `fs` instead of `vscode.workspace.fs`.
 */

import { watch, type FSWatcher } from 'fs';
import { readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';

import {
  applyLayout,
  AtlasParseError,
  deserializeModel,
  serializeLayout,
  serializeModel,
} from '../shared/serialization/yaml';
import { CURRENT_MODEL_VERSION, createEmptyModel, type ArchitectureModel } from '../shared/model/types';

export const ATLAS_FILE_NAME = 'atlas.yaml';
export const ATLAS_LAYOUT_FILE_NAME = 'atlas.layout.yaml';

/** Thrown when a write would overwrite an external edit this session hasn't ingested yet. */
export class AtlasWriteConflictError extends Error {
  constructor() {
    super('atlas.yaml changed on disk since it was last read.');
    this.name = 'AtlasWriteConflictError';
  }
}

export interface ReadResult {
  model: ArchitectureModel;
  /** Present when the file exists but could not be parsed. */
  error?: string;
  /** True when the file was written by a newer Atlas and must not be overwritten. */
  readOnly?: boolean;
}

export class StandaloneFileService {
  private readonly filePath: string;
  private readonly layoutPath: string;
  private readonly watcher: FSWatcher;
  private readonly listeners = new Set<() => void>();

  /** Last logical text we wrote, used to ignore our own change notifications. */
  private lastWrittenText: string | undefined;
  private lastWrittenLayout: string | undefined;
  /** Serializes write() calls so they never interleave. */
  private writeChain: Promise<void> = Promise.resolve();
  /** Set when the on-disk file is a newer schema than this build understands. */
  private futureVersion = false;

  constructor(cwd: string) {
    this.filePath = join(cwd, ATLAS_FILE_NAME);
    this.layoutPath = join(cwd, ATLAS_LAYOUT_FILE_NAME);
    // Watch the directory (not the file directly) so this survives the file
    // not existing yet and atomic renames onto it.
    this.watcher = watch(cwd, (_event, filename) => {
      if (filename === ATLAS_FILE_NAME) {
        void this.handleFileSystemEvent();
      }
    });
  }

  /** Fired when `atlas.yaml` changes on disk due to an external edit. Returns an unsubscribe fn. */
  onDidChangeExternally(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read and parse `atlas.yaml`, returning an empty model when absent. */
  async read(): Promise<ReadResult> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch {
      return { model: createEmptyModel() }; // file does not exist yet — a valid starting state
    }
    try {
      const logical = deserializeModel(text);
      this.futureVersion = logical.version > CURRENT_MODEL_VERSION;
      const model = applyLayout(logical, await this.readLayoutText());
      this.lastWrittenText = text;
      return this.futureVersion ? { model, readOnly: true } : { model };
    } catch (error) {
      const message = error instanceof AtlasParseError ? error.message : 'Failed to read atlas.yaml.';
      return { model: createEmptyModel(), error: message };
    }
  }

  private async readLayoutText(): Promise<string> {
    try {
      return await readFile(this.layoutPath, 'utf8');
    } catch {
      return ''; // no sidecar yet — applyLayout falls back to auto-layout
    }
  }

  write(model: ArchitectureModel): Promise<void> {
    const next = this.writeChain.then(() => this.writeNow(model));
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async writeNow(model: ArchitectureModel): Promise<void> {
    if (this.futureVersion) {
      return; // refuse to overwrite a file written by a newer Atlas
    }
    const logicalText = serializeModel(model);
    if (logicalText !== this.lastWrittenText) {
      const onDisk = await this.readTextOrUndefined(this.filePath);
      if (onDisk !== undefined && this.lastWrittenText !== undefined && onDisk !== this.lastWrittenText) {
        throw new AtlasWriteConflictError();
      }
      await this.writeAtomic(this.filePath, logicalText);
      this.lastWrittenText = logicalText;
    }
    const layoutText = serializeLayout(model);
    if (layoutText !== this.lastWrittenLayout) {
      await this.writeAtomic(this.layoutPath, layoutText);
      this.lastWrittenLayout = layoutText;
    }
  }

  private async readTextOrUndefined(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return undefined; // absent — nothing to conflict with
    }
  }

  private async writeAtomic(path: string, text: string): Promise<void> {
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, path); // Node's rename replaces an existing destination on both POSIX and Windows
  }

  private async handleFileSystemEvent(): Promise<void> {
    let currentText: string | undefined;
    try {
      currentText = await readFile(this.filePath, 'utf8');
    } catch {
      currentText = undefined; // deleted
    }
    if (currentText !== undefined && currentText === this.lastWrittenText) {
      return; // our own write echoed back — ignore
    }
    this.lastWrittenText = currentText;
    for (const listener of this.listeners) {
      listener();
    }
  }

  dispose(): void {
    this.watcher.close();
    this.listeners.clear();
  }
}
