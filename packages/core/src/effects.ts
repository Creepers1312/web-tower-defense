/**
 * The effect system is the primary extension seam for tower abilities.
 *
 * An {@link Effect} is a small, composable behaviour referenced *by name* from
 * {@link TowerDef.effects} (and {@link UpgradeTier.addEffects}). Parameters come
 * from the tower's data (its def / current tiers) — never hard-coded here — so a
 * new ability can be added purely as data + one registered effect, with no
 * changes to the core simulation loop.
 *
 * As of Milestone 2 the combat system invokes a tower's active effects on every
 * projectile impact, passing the firing tower and the enemy it hit.
 */

import type { World } from './world.js';
import type { EnemyInstance, TowerInstance } from './types.js';
import { effectiveStats } from './upgrade.js';

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
    // Use the tower's effective (upgraded) damage, read from its data.
    target.hp -= effectiveStats(def, tower).damage;
  },
};

/**
 * Placeholder: allow a shot to hit multiple enemies in a line.
 * The seam is wired (this runs on impact), but the multi-hit geometry is left
 * for a later milestone — it currently does nothing on its own.
 */
export const pierce: Effect = {
  apply() {
    /* no-op: reserved for multi-hit behaviour */
  },
};

/**
 * Placeholder: fire several projectiles per shot.
 * The seam is wired (this runs on impact), but the extra-projectile logic is
 * left for a later milestone — it currently does nothing on its own.
 */
export const multishot: Effect = {
  apply() {
    /* no-op: reserved for extra-projectile behaviour */
  },
};
