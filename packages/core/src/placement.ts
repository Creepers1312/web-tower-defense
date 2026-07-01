/**
 * Pure geometry helpers for deciding whether a tower may be placed at a point.
 *
 * A placement is legal when the point is inside a buildable zone, far enough
 * from the enemy path, and not overlapping an existing tower.
 */

import type { MapDef, Rect, TowerInstance, Vec2 } from './types.js';

/** Minimum distance a tower must keep from the path centre-line. */
export const PATH_CLEARANCE = 22;
/** Minimum distance between two tower centres. */
export const TOWER_SPACING = 26;

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Shortest distance from point `p` to the segment `a`–`b`. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Project p onto the segment, clamped to [0, 1].
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Shortest distance from a point to the whole polyline path. */
export function distanceToPath(p: Vec2, path: Vec2[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) {
    const only = path[0]!;
    return Math.hypot(p.x - only.x, p.y - only.y);
  }
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distanceToSegment(p, path[i]!, path[i + 1]!));
  }
  return best;
}

/**
 * Whether a tower may be placed at `pos` on `map`, given the towers already
 * present. Pure and side-effect free.
 */
export function canPlaceTower(map: MapDef, pos: Vec2, towers: TowerInstance[]): boolean {
  // Must be inside at least one buildable zone.
  if (!map.buildableZones.some((z) => pointInRect(pos, z))) return false;
  // Must not sit on (or too close to) the path.
  if (distanceToPath(pos, map.path) < PATH_CLEARANCE) return false;
  // Must not overlap an existing tower.
  for (const t of towers) {
    if (Math.hypot(pos.x - t.pos.x, pos.y - t.pos.y) < TOWER_SPACING) return false;
  }
  return true;
}
