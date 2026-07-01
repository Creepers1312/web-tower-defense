/**
 * Upgrade rules.
 *
 * Every tower has two upgrade paths of four tiers each, but only ONE path may
 * advance beyond tier 2. This is the classic "you can specialise deeply in one
 * branch while dabbling in the other" constraint.
 */

import type { StatModifiers, TowerDef, TowerInstance } from './types.js';

/** The path index not equal to `path`. */
function otherPath(path: 0 | 1): 0 | 1 {
  return path === 0 ? 1 : 0;
}

/**
 * Can `tower` buy the next tier on `path`?
 *
 * Rules (symmetric for both paths):
 *  - false if the path is already at tier 4 (maxed out).
 *  - false if the path is at tier >= 2 AND the other path is at tier > 2
 *    (only one path may exceed tier 2).
 *  - true otherwise.
 */
export function canUpgrade(tower: TowerInstance, path: 0 | 1): boolean {
  const current = tower.tiers[path];
  const other = tower.tiers[otherPath(path)];

  if (current >= 4) return false;
  if (current >= 2 && other > 2) return false;
  return true;
}

/**
 * Cost of the next tier on `path`, or `undefined` if the path is maxed out.
 */
export function nextTierCost(def: TowerDef, tower: TowerInstance, path: 0 | 1): number | undefined {
  const nextTier = tower.tiers[path]; // tiers array is 0-indexed; current level == next index
  const tier = def.paths[path].tiers[nextTier];
  return tier?.cost;
}

/**
 * Compute a tower's effective stats by folding in every purchased tier's
 * additive modifiers on top of the base def. Pure and side-effect free.
 */
export function effectiveStats(def: TowerDef, tower: TowerInstance): {
  range: number;
  fireRate: number;
  damage: number;
} {
  let range = def.range;
  let fireRate = def.fireRate;
  let damage = def.damage;

  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    const level = tower.tiers[path];
    for (let t = 0; t < level; t++) {
      const mods: StatModifiers = def.paths[path].tiers[t].modifiers;
      range += mods.range ?? 0;
      fireRate += mods.fireRate ?? 0;
      damage += mods.damage ?? 0;
    }
  }

  return { range, fireRate, damage };
}

/**
 * The list of effect names a tower currently has: its base effects plus every
 * effect added by a purchased upgrade tier. Order is preserved and duplicates
 * are removed (first occurrence wins).
 */
export function activeEffects(def: TowerDef, tower: TowerInstance): string[] {
  const names: string[] = [...def.effects];

  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    const level = tower.tiers[path];
    for (let t = 0; t < level; t++) {
      const added = def.paths[path].tiers[t].addEffects;
      if (added) names.push(...added);
    }
  }

  return [...new Set(names)];
}
