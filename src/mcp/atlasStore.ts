/**
 * Filesystem-backed access to `atlas.yaml` for the MCP server.
 *
 * The MCP server runs as its own process (launched by Claude Code), so it
 * cannot use the VS Code file service. It reuses the shared serialization,
 * validation, and layout instead — the same domain core the extension uses —
 * which guarantees both writers agree on the file format. Edits here trigger
 * the extension's file watcher, so the canvas updates live.
 */

import { readFile, rename, writeFile } from 'fs/promises';
import { isAbsolute, join, normalize } from 'path';

import { computeLayout } from '../shared/model/layout';
import { isNodeTypeId, type NodeTypeId } from '../shared/model/nodeTypes';
import { DEFAULT_PROTOCOL, isProtocolId, type ProtocolId } from '../shared/model/protocols';
import { createEmptyModel, type ArchitectureModel, type ArchitectureNode } from '../shared/model/types';
import { deserializeModel, serializeModel } from '../shared/serialization/yaml';
import { validateModel } from '../shared/serialization/validation';

export class AtlasStore {
  private readonly filePath: string;
  /** Serializes mutate() calls within this process so they read-modify-write atomically. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(workspaceDir: string) {
    this.filePath = join(workspaceDir, 'atlas.yaml');
  }

  async read(): Promise<ArchitectureModel> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      return deserializeModel(text);
    } catch {
      return createEmptyModel();
    }
  }

  /**
   * Apply a transform, validate, and persist. Calls are serialized so two MCP
   * tool invocations can't lose each other's updates, and the write is atomic
   * (temp file + rename) so a crash can't truncate atlas.yaml.
   */
  mutate<T>(
    transform: (model: ArchitectureModel) => { model: ArchitectureModel; result: T },
  ): Promise<T> {
    const next = this.chain.then(async () => {
      const current = await this.read();
      const { model, result } = transform(current);
      const validation = validateModel(model);
      if (!validation.valid) {
        const messages = validation.issues.map((i) => i.message).join('; ');
        throw new Error(`Resulting architecture is invalid: ${messages}`);
      }
      const temp = `${this.filePath}.tmp`;
      await writeFile(temp, serializeModel(model), 'utf8');
      await rename(temp, this.filePath);
      return result;
    });
    // Keep the chain alive even if this mutation rejects.
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export function coerceNodeType(value: string): NodeTypeId {
  return isNodeTypeId(value) ? value : 'service';
}

export function coerceProtocol(value: string | undefined): ProtocolId {
  return value && isProtocolId(value) ? value : DEFAULT_PROTOCOL;
}

/** Place a node sensibly: reuse layout for the whole graph after insertion. */
export function withAutoLayout(model: ArchitectureModel): ArchitectureModel {
  const positions = computeLayout(model.nodes, model.edges);
  return {
    ...model,
    nodes: model.nodes.map((node) => ({
      ...node,
      position: node.position.x || node.position.y ? node.position : positions.get(node.id) ?? node.position,
    })),
  };
}

export function makeUniqueId(existing: Iterable<string>, base: string): string {
  const used = new Set(existing);
  const slug =
    base
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node';
  if (!used.has(slug)) {
    return slug;
  }
  let counter = 2;
  while (used.has(`${slug}-${counter}`)) {
    counter += 1;
  }
  return `${slug}-${counter}`;
}

export function findNode(model: ArchitectureModel, id: string): ArchitectureNode | undefined {
  return model.nodes.find((node) => node.id === id);
}

/** A mapping path must stay inside the workspace: relative, no `..` escape. */
export function assertSafePath(path: string): void {
  const norm = normalize(path).replace(/\\/g, '/');
  if (isAbsolute(path) || norm === '..' || norm.startsWith('../')) {
    throw new Error(`Path "${path}" must be workspace-relative and not escape the workspace.`);
  }
}
