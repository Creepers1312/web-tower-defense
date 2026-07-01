/**
 * Pure helpers for walking a polyline path.
 *
 * Enemies store a single scalar `distance` (how far they have travelled along
 * the whole path). Converting that scalar to a world position keeps movement
 * trivial to reason about and to test.
 */

import type { Vec2 } from './types.js';

export interface PathProgress {
  /** Interpolated world position at the given distance. */
  pos: Vec2;
  /** Index of the segment currently being traversed (0-based). */
  segment: number;
  /** True once the distance meets or exceeds the total path length. */
  done: boolean;
}

/** Total length of a polyline path in world units. */
export function pathLength(path: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Position on `path` after travelling `distance` units from the start.
 *
 * Clamps to the first waypoint for negative distances and to the last waypoint
 * once the end is reached (flagged via `done`).
 */
export function progressAlongPath(path: Vec2[], distance: number): PathProgress {
  if (path.length === 0) {
    return { pos: { x: 0, y: 0 }, segment: 0, done: true };
  }
  const first = path[0];
  if (path.length === 1) {
    return { pos: { x: first.x, y: first.y }, segment: 0, done: true };
  }
  if (distance <= 0) {
    return { pos: { x: first.x, y: first.y }, segment: 0, done: false };
  }

  let remaining = distance;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segLen) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return {
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        segment: i,
        done: false,
      };
    }
    remaining -= segLen;
  }

  const last = path[path.length - 1];
  return { pos: { x: last.x, y: last.y }, segment: path.length - 2, done: true };
}
