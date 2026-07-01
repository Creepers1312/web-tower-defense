/**
 * Upgrade rules.
 *
 * Every tower has two upgrade paths of four tiers each, but only ONE path may
 * advance beyond tier 2. This is the classic "you can specialise deeply in one
 * branch while dabbling in the other" constraint.
 */

import type { AbilityDef, GameState, StatModifiers, TowerDef, TowerInstance } from './types.js';

export interface ResolvedCapabilities {
  camoDetection: boolean;
  popsLead: boolean;
}

/** Multipliers applied to a tower's stats by any active nearby ability. */
export interface AbilityBuff {
  fireRate: number;
  damage: number;
  range: number;
}

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
  pierce: number;
  shots: number;
} {
  let range = def.range;
  let fireRate = def.fireRate;
  let damage = def.damage;
  let pierce = def.pierce ?? 0; // extra enemies hit per shot (base hits one)
  let shots = def.shots ?? 1; // projectiles per shot

  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    const level = tower.tiers[path];
    for (let t = 0; t < level; t++) {
      const mods: StatModifiers = def.paths[path].tiers[t].modifiers;
      range += mods.range ?? 0;
      fireRate += mods.fireRate ?? 0;
      damage += mods.damage ?? 0;
      pierce += mods.pierce ?? 0;
      shots += mods.shots ?? 0;
    }
  }

  return { range, fireRate, damage, pierce, shots };
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

/**
 * A tower's current special capabilities: its base capabilities plus every
 * capability granted by a purchased upgrade tier.
 */
export function towerCapabilities(def: TowerDef, tower: TowerInstance): ResolvedCapabilities {
  let camoDetection = def.camoDetection ?? false;
  let popsLead = def.popsLead ?? false;

  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    const level = tower.tiers[path];
    for (let t = 0; t < level; t++) {
      const grants = def.paths[path].tiers[t].grants;
      if (grants?.camoDetection) camoDetection = true;
      if (grants?.popsLead) popsLead = true;
    }
  }

  return { camoDetection, popsLead };
}

/**
 * The activated ability a tower currently has, or null. The deepest purchased
 * tier that carries an ability wins (later tiers override earlier ones).
 */
export function towerAbility(def: TowerDef, tower: TowerInstance): AbilityDef | null {
  let ability: AbilityDef | null = null;

  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    const level = tower.tiers[path];
    for (let t = 0; t < level; t++) {
      const a = def.paths[path].tiers[t].ability;
      if (a) ability = a;
    }
  }

  return ability;
}

/**
 * Combined buff multipliers applied to `tower` right now by every ally whose
 * ability is currently active and whose radius covers this tower (a tower's own
 * active ability buffs itself). Returns 1× multipliers when nothing applies.
 */
export function abilityBuff(
  state: GameState,
  getTower: (id: string) => TowerDef | undefined,
  tower: TowerInstance,
): AbilityBuff {
  let fireRate = 1;
  let damage = 1;
  let range = 1;

  for (const source of state.towers) {
    if (source.abilityActive <= 0) continue;
    const sourceDef = getTower(source.type);
    if (!sourceDef) continue;
    const ability = towerAbility(sourceDef, source);
    if (!ability) continue;
    const d = Math.hypot(source.pos.x - tower.pos.x, source.pos.y - tower.pos.y);
    if (d > ability.radius) continue;
    fireRate *= ability.buff.fireRate ?? 1;
    damage *= ability.buff.damage ?? 1;
    range *= ability.buff.range ?? 1;
  }

  return { fireRate, damage, range };
}
