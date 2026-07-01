import { describe, it, expect } from 'vitest';
import {
  canPlaceTower,
  distanceToPath,
  pointInRect,
  type MapDef,
  type TowerInstance,
} from '../src/index.js';

const map: MapDef = {
  id: 'm',
  name: 'M',
  path: [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ],
  buildableZones: [{ x: 0, y: 0, width: 200, height: 200 }],
  waves: [],
};

function tower(x: number, y: number): TowerInstance {
  return { id: 't', type: 'x', pos: { x, y }, tiers: [0, 0], targeting: 'first', cooldown: 0 };
}

describe('placement geometry', () => {
  it('pointInRect', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInRect({ x: 5, y: 5 }, r)).toBe(true);
    expect(pointInRect({ x: 11, y: 5 }, r)).toBe(false);
  });

  it('distanceToPath measures to the nearest segment', () => {
    expect(distanceToPath({ x: 100, y: 130 }, map.path)).toBeCloseTo(30, 5);
    expect(distanceToPath({ x: 100, y: 100 }, map.path)).toBeCloseTo(0, 5);
  });
});

describe('canPlaceTower', () => {
  it('allows a spot inside the zone and clear of the path', () => {
    expect(canPlaceTower(map, { x: 100, y: 140 }, [])).toBe(true);
  });

  it('rejects a spot on/too close to the path', () => {
    expect(canPlaceTower(map, { x: 100, y: 100 }, [])).toBe(false);
    expect(canPlaceTower(map, { x: 100, y: 110 }, [])).toBe(false); // within clearance
  });

  it('rejects a spot outside every buildable zone', () => {
    expect(canPlaceTower(map, { x: 500, y: 500 }, [])).toBe(false);
  });

  it('rejects a spot overlapping an existing tower', () => {
    const existing = [tower(100, 150)];
    expect(canPlaceTower(map, { x: 105, y: 150 }, existing)).toBe(false); // too close
    expect(canPlaceTower(map, { x: 160, y: 150 }, existing)).toBe(true); // far enough
  });
});
