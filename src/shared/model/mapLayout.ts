/**
 * Cartographic layout — arranges the model like a *map* rather than a generic
 * graph: components cluster into their bounded-context "districts", data flows
 * west→east within each district (frontend/edge on the coast, datastores in the
 * interior), and external systems sit offshore to the east. Districts are
 * placed in a stable, deterministic order so the same model always produces the
 * same map and an engineer can build spatial memory of it.
 */

import type { NodeTypeId } from './nodeTypes';
import type { ArchitectureEdge, ArchitectureNode, Position } from './types';

/** West→east tier: lower sits on the coast, higher in the interior / offshore. */
const TIER: Record<NodeTypeId, number> = {
  frontend: 0,
  service: 1,
  queue: 1,
  cache: 2,
  database: 2,
  externalApi: 3,
};

const NODE_W = 230;
const NODE_H = 84;
const COL_GAP = 90;
const ROW_GAP = 30;
const DISTRICT_PAD = 46;
const DISTRICT_GUTTER = 90; // "water" between land masses
const MAX_ROW_WIDTH = 2400;
const ORIGIN = 80;

type LayoutNode = Pick<ArchitectureNode, 'id' | 'type' | 'groupId'>;

const UNGROUPED = '__ungrouped__';

interface District {
  key: string;
  members: LayoutNode[];
  avgTier: number;
  width: number;
  height: number;
  /** Local positions of members, relative to the district's top-left. */
  local: Map<string, Position>;
}

export function computeMapLayout(
  nodes: LayoutNode[],
  _edges: Pick<ArchitectureEdge, 'source' | 'target'>[] = [],
): Map<string, Position> {
  // 1. Bucket nodes into districts (real contexts, plus one ungrouped bucket).
  const buckets = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const key = node.groupId ?? UNGROUPED;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(node);
  }

  // 2. Lay out each district internally (tier = column, stacked in rows).
  const districts: District[] = [];
  for (const [key, members] of buckets) {
    districts.push(layoutDistrict(key, members));
  }

  // 3. Order districts: coastal (low avg tier) first, ungrouped/offshore last,
  //    tie-broken by key for determinism.
  districts.sort((a, b) => {
    const ao = a.key === UNGROUPED ? Number.POSITIVE_INFINITY : a.avgTier;
    const bo = b.key === UNGROUPED ? Number.POSITIVE_INFINITY : b.avgTier;
    return ao - bo || a.key.localeCompare(b.key);
  });

  // 4. Place districts left→right, wrapping to a new band when too wide. Rows of
  //    land separated by "water" gutters.
  const positions = new Map<string, Position>();
  let cursorX = ORIGIN;
  let bandY = ORIGIN;
  let bandHeight = 0;
  for (const district of districts) {
    if (cursorX > ORIGIN && cursorX + district.width > MAX_ROW_WIDTH) {
      cursorX = ORIGIN;
      bandY += bandHeight + DISTRICT_GUTTER;
      bandHeight = 0;
    }
    for (const member of district.members) {
      const local = district.local.get(member.id)!;
      positions.set(member.id, { x: cursorX + local.x, y: bandY + local.y });
    }
    cursorX += district.width + DISTRICT_GUTTER;
    bandHeight = Math.max(bandHeight, district.height);
  }
  return positions;
}

function layoutDistrict(key: string, members: LayoutNode[]): District {
  // Group members by tier (column); preserve input order within a column.
  const byTier = new Map<number, LayoutNode[]>();
  let tierSum = 0;
  for (const m of members) {
    const tier = TIER[m.type];
    tierSum += tier;
    (byTier.get(tier) ?? byTier.set(tier, []).get(tier)!).push(m);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  const rows = Math.max(...[...byTier.values()].map((c) => c.length), 1);

  const local = new Map<string, Position>();
  tiers.forEach((tier, col) => {
    const column = byTier.get(tier)!;
    // Vertically centre shorter columns within the district.
    const offset = ((rows - column.length) * (NODE_H + ROW_GAP)) / 2;
    column.forEach((member, row) => {
      local.set(member.id, {
        x: DISTRICT_PAD + col * (NODE_W + COL_GAP),
        y: DISTRICT_PAD + offset + row * (NODE_H + ROW_GAP),
      });
    });
  });

  const width = DISTRICT_PAD * 2 + tiers.length * NODE_W + Math.max(0, tiers.length - 1) * COL_GAP;
  const height = DISTRICT_PAD * 2 + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP;
  return { key, members, avgTier: members.length ? tierSum / members.length : 0, width, height, local };
}
