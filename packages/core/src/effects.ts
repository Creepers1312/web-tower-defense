/**
 * The effect system is the primary extension seam for tower abilities.
 *
 * An {@link Effect} is a small, composable behaviour referenced *by name* from
 * {@link TowerDef.effects} (and {@link UpgradeTier.addEffects}). Parameters come
 * from the tower's data (its def / current tiers) — never hard-coded here — so a
 * new ability can be added purely as data + one registered effect, with no
 * changes to the core simulation loop.
 *
 * NOTE (Milestone 1): combat is not yet ticked, so these effects are registered
 * and validated but not invoked at runtime. They exist to lock in the seam.
 */

import type { World } from './world.js';
import type { EnemyInstance, TowerInstance } from './types.js';

export interface EffectContext {
  world: World;
  tower: TowerInstance;
  /** The enemy the tower is currently acting on, or null if none. */
  target: EnemyInstance | null;
  /** Fixed simulation timestep in seconds. */
  dt: number;
}

export interface Effect {
  apply(ctx: EffectContext): void;
}

/**
 * Deal the tower's damage to the current target.
 *
 * Reads the damage value from the tower's definition (data-driven) rather than
 * embedding a constant.
 */
export const directDamage: Effect = {
  apply({ world, tower, target }) {
    if (!target) return;
    const def = world.getRegistry().getTower(tower.type);
    if (!def) return;
    // Damage will later be combined with upgrade modifiers; base value for now.
    target.hp -= def.damage;
  },
};

/**
 * Placeholder: allow a shot to hit multiple enemies in a line.
 * Concrete behaviour arrives with the combat system in a later milestone.
 */
export const pierce: Effect = {
  apply() {
    /* no-op until the combat/projectile system exists */
  },
};

/**
 * Placeholder: fire several projectiles per shot.
 * Concrete behaviour arrives with the combat system in a later milestone.
 */
export const multishot: Effect = {
  apply() {
    /* no-op until the combat/projectile system exists */
  },
};
