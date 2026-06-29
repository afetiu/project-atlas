/**
 * Geometry for "floating" edges: instead of anchoring to fixed left/right
 * handles, an edge connects to the point on each node's perimeter that faces
 * the other node. This keeps connections clean regardless of relative position
 * (vertical, diagonal, cross-region), which the fixed-handle routing could not.
 *
 * Adapted from the canonical React Flow floating-edges recipe.
 */

import { Position, type Node } from 'reactflow';

interface IntersectionNode {
  width?: number | null;
  height?: number | null;
  positionAbsolute?: { x: number; y: number };
}

function getNodeIntersection(intersectionNode: IntersectionNode, targetNode: IntersectionNode) {
  const w = (intersectionNode.width ?? 0) / 2;
  const h = (intersectionNode.height ?? 0) / 2;
  const ip = intersectionNode.positionAbsolute ?? { x: 0, y: 0 };
  const tp = targetNode.positionAbsolute ?? { x: 0, y: 0 };

  const x2 = ip.x + w;
  const y2 = ip.y + h;
  const x1 = tp.x + (targetNode.width ?? 0) / 2;
  const y1 = tp.y + (targetNode.height ?? 0) / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  const x = w * (xx3 + yy3) + x2;
  const y = h * (-xx3 + yy3) + y2;

  return { x, y };
}

function getEdgePosition(node: IntersectionNode, point: { x: number; y: number }): Position {
  const nx = Math.round(node.positionAbsolute?.x ?? 0);
  const ny = Math.round(node.positionAbsolute?.y ?? 0);
  const px = Math.round(point.x);
  const py = Math.round(point.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + (node.width ?? 0) - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + (node.height ?? 0) - 1) return Position.Bottom;
  return Position.Top;
}

export function getEdgeParams(source: Node, target: Node) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);
  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}
