/**
 * Structural validation for the architecture model.
 *
 * Validation is deliberately separated from parsing (`yaml.ts`) so it can run
 * on any in-memory model regardless of where it came from — a freshly parsed
 * file, or a graph the user just edited in the canvas. Both sides of the
 * extension reuse this to enforce the same invariants.
 */

import { isNodeTypeId } from '../model/nodeTypes';
import { isProtocolId } from '../model/protocols';
import type { ArchitectureModel } from '../model/types';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  /** The id of the offending node or edge, when applicable. */
  entityId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate the invariants required for a coherent architecture graph:
 *  - node ids are unique (no duplicate IDs)
 *  - every edge references existing source and target nodes (no broken edges)
 *  - node types and edge protocols are known values
 */
export function validateModel(model: ArchitectureModel): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seenNodeIds = new Set<string>();

  for (const node of model.nodes) {
    if (!node.id) {
      issues.push({ severity: 'error', message: 'A node is missing an id.' });
      continue;
    }
    if (seenNodeIds.has(node.id)) {
      issues.push({
        severity: 'error',
        message: `Duplicate node id "${node.id}".`,
        entityId: node.id,
      });
    }
    seenNodeIds.add(node.id);

    if (!isNodeTypeId(node.type)) {
      issues.push({
        severity: 'error',
        message: `Node "${node.id}" has an unknown type "${String(node.type)}".`,
        entityId: node.id,
      });
    }
  }

  const seenGroupIds = new Set<string>();
  for (const group of model.groups) {
    if (!group.id) {
      issues.push({ severity: 'error', message: 'A group is missing an id.' });
      continue;
    }
    if (seenGroupIds.has(group.id)) {
      issues.push({
        severity: 'error',
        message: `Duplicate group id "${group.id}".`,
        entityId: group.id,
      });
    }
    seenGroupIds.add(group.id);
  }

  for (const node of model.nodes) {
    if (node.groupId && !seenGroupIds.has(node.groupId)) {
      issues.push({
        severity: 'warning',
        message: `Node "${node.id}" references a missing group "${node.groupId}".`,
        entityId: node.id,
      });
    }
    if (isUnsafeMappingPath(node.mapping?.path)) {
      issues.push({
        severity: 'warning',
        message: `Node "${node.id}" maps to a path outside the workspace ("${node.mapping?.path}").`,
        entityId: node.id,
      });
    }
  }
  for (const group of model.groups) {
    if (isUnsafeMappingPath(group.mapping?.path)) {
      issues.push({
        severity: 'warning',
        message: `Context "${group.id}" maps to a path outside the workspace ("${group.mapping?.path}").`,
        entityId: group.id,
      });
    }
  }

  const seenEdgeIds = new Set<string>();
  for (const edge of model.edges) {
    if (edge.id && seenEdgeIds.has(edge.id)) {
      issues.push({
        severity: 'error',
        message: `Duplicate edge id "${edge.id}".`,
        entityId: edge.id,
      });
    }
    if (edge.id) {
      seenEdgeIds.add(edge.id);
    }

    if (!seenNodeIds.has(edge.source)) {
      issues.push({
        severity: 'error',
        message: `Edge "${edge.id}" references a missing source node "${edge.source}".`,
        entityId: edge.id,
      });
    }
    if (!seenNodeIds.has(edge.target)) {
      issues.push({
        severity: 'error',
        message: `Edge "${edge.id}" references a missing target node "${edge.target}".`,
        entityId: edge.id,
      });
    }
    if (!isProtocolId(edge.protocol)) {
      issues.push({
        severity: 'warning',
        message: `Edge "${edge.id}" has an unknown protocol "${String(edge.protocol)}".`,
        entityId: edge.id,
      });
    }
  }

  const valid = !issues.some((issue) => issue.severity === 'error');
  return { valid, issues };
}

/**
 * Lexical guard for a code-mapping path: flags absolute paths and `..` traversal
 * that would point outside the workspace. This is a portable (no-fs) signal for
 * the Issues panel; the hard enforcement is `resolveWithinRoot` at every actual
 * filesystem boundary.
 */
function isUnsafeMappingPath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return true; // absolute (POSIX or Windows drive)
  }
  return normalized.split('/').some((segment) => segment === '..');
}
