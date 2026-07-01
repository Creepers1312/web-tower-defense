import { describe, it, expect } from 'vitest';
import { canUpgrade, effectiveStats, type TowerDef, type TowerInstance } from '../src/index.js';

/** Build a tower instance with the given tiers on each path. */
function tower(a: number, b: number): TowerInstance {
  return {
    id: 't',
    type: 'x',
    pos: { x: 0, y: 0 },
    tiers: [a, b],
    targeting: 'first',
    cooldown: 0,
  };
}

describe('canUpgrade', () => {
  it('allows upgrading from the base state on either path', () => {
    expect(canUpgrade(tower(0, 0), 0)).toBe(true);
    expect(canUpgrade(tower(0, 0), 1)).toBe(true);
  });

  it('refuses to upgrade a path that is already maxed (tier 4)', () => {
    expect(canUpgrade(tower(4, 0), 0)).toBe(false);
    expect(canUpgrade(tower(0, 4), 1)).toBe(false);
  });

  it('allows a path to reach tier 2 regardless of the other path', () => {
    // current tier 1 -> 2 is always fine.
    expect(canUpgrade(tower(1, 3), 0)).toBe(true);
    expect(canUpgrade(tower(3, 1), 1)).toBe(true);
  });

  it('lets a single path go deep (beyond tier 2) while the other stays <= 2', () => {
    expect(canUpgrade(tower(2, 2), 0)).toBe(true); // 2 -> 3, other is 2 (not > 2)
    expect(canUpgrade(tower(3, 2), 0)).toBe(true); // 3 -> 4, other is 2
    expect(canUpgrade(tower(2, 3), 1)).toBe(true); // deep path keeps going
  });

  it('blocks a second path from exceeding tier 2 once the other is > 2', () => {
    expect(canUpgrade(tower(2, 3), 0)).toBe(false); // path 0 at 2, other at 3
    expect(canUpgrade(tower(3, 2), 1)).toBe(false); // path 1 at 2, other at 3
    expect(canUpgrade(tower(2, 4), 0)).toBe(false);
  });

  it('is symmetric between the two paths', () => {
    for (let a = 0; a <= 4; a++) {
      for (let b = 0; b <= 4; b++) {
        expect(canUpgrade(tower(a, b), 0)).toBe(canUpgrade(tower(b, a), 1));
      }
    }
  });
});

describe('effectiveStats', () => {
  const def: TowerDef = {
    id: 'x',
    name: 'X',
    cost: 100,
    range: 100,
    fireRate: 1,
    damage: 1,
    targeting: 'first',
    effects: [],
    paths: [
      {
        tiers: [
          { name: 'a1', cost: 10, modifiers: { damage: 1 } },
          { name: 'a2', cost: 20, modifiers: { fireRate: 1 } },
          { name: 'a3', cost: 30, modifiers: { range: 50 } },
          { name: 'a4', cost: 40, modifiers: { damage: 5 } },
        ],
      },
      {
        tiers: [
          { name: 'b1', cost: 10, modifiers: { range: 20 } },
          { name: 'b2', cost: 20, modifiers: { range: 20 } },
          { name: 'b3', cost: 30, modifiers: {} },
          { name: 'b4', cost: 40, modifiers: {} },
        ],
      },
    ],
  };

  it('returns base stats at tier [0, 0]', () => {
    expect(effectiveStats(def, tower(0, 0))).toEqual({ range: 100, fireRate: 1, damage: 1 });
  });

  it('folds in additive modifiers from both paths', () => {
    // path0 tier2 => +damage 1, +fireRate 1 ; path1 tier1 => +range 20
    expect(effectiveStats(def, tower(2, 1))).toEqual({ range: 120, fireRate: 2, damage: 2 });
  });
});
