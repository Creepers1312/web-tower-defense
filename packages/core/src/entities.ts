/**
 * Factory functions that build runtime instances from content definitions.
 *
 * Kept separate from {@link World} so both the world and command handlers can
 * create entities without any circular imports, and so instance creation stays
 * a pure, easily-testable transformation of def -> instance.
 */

import type {
  EnemyDef,
  EnemyInstance,
  TargetingMode,
  TowerDef,
  TowerInstance,
  Vec2,
} from './types.js';

/** Build a fresh enemy instance placed at the start of the path. */
export function createEnemyInstance(def: EnemyDef, id: string, start: Vec2): EnemyInstance {
  return {
    id,
    type: def.id,
    hp: def.hp,
    maxHp: def.hp,
    pos: { x: start.x, y: start.y },
    pathIndex: 0,
    distance: 0,
    speed: def.speed,
    leakDamage: def.leakDamage,
    reward: def.reward,
    flags: [...def.flags],
    alive: true,
  };
}

/** Build a fresh tower instance at tier [0, 0] with the def's default targeting. */
export function createTowerInstance(
  def: TowerDef,
  id: string,
  pos: Vec2,
  targeting: TargetingMode = def.targeting,
): TowerInstance {
  return {
    id,
    type: def.id,
    pos: { x: pos.x, y: pos.y },
    tiers: [0, 0],
    targeting,
    cooldown: 0,
  };
}
