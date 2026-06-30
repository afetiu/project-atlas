/**
 * Merge a freshly-extracted structural map into the existing one, preserving
 * human/AI intent. This is what makes the map *self-maintaining*: re-running
 * extraction refreshes what the code actually is (which components exist, which
 * depend on which, their contexts) while keeping what people added on top —
 * custom names, descriptions, canvas layout, and live MCP bindings.
 *
 * Contract:
 *   - Structure (node existence, type, code mapping, contexts, edges) comes from
 *     the freshly extracted model — the code is authoritative about itself.
 *   - Intent (name, description, position, binding) is preserved from the
 *     existing model for any component whose id (i.e. its code location) still
 *     exists. New components are added; vanished ones are dropped.
 */

import type { ArchitectureModel } from '../model/types';

export function mergeExtraction(existing: ArchitectureModel, extracted: ArchitectureModel): ArchitectureModel {
  const prev = new Map(existing.nodes.map((node) => [node.id, node]));

  const nodes = extracted.nodes.map((node) => {
    const before = prev.get(node.id);
    if (!before) {
      return node; // newly-appeared component — take it as extracted
    }
    return {
      ...node, // structure: type, mapping, groupId from the code
      name: before.name, // keep the chosen display name (same id = same location)
      description: before.description || node.description,
      position: before.position, // keep layout so spatial memory survives
      ...(before.binding ? { binding: before.binding } : {}),
    };
  });

  return {
    version: extracted.version,
    nodes,
    edges: extracted.edges,
    groups: extracted.groups,
  };
}
