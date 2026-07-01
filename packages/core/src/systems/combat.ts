/**
 * combatSystem — towers acquire targets and fire.
 *
 * Each tower counts down a cooldown; when ready it picks a target within its
 * (effective) range according to its targeting mode and fires a projectile
 * carrying its effective damage and a snapshot of its active effects. The
 * projectileSystem resolves the impact.
 */

import type { SystemContext } from './context.js';
import type { EnemyInstance, TargetingMode, Vec2 } from '../types.js';
import { effectiveStats, activeEffects } from '../upgrade.js';

/** Speed of fired projectiles, in world units per second. */
export const PROJECTILE_SPEED = 420;

/**
 * Choose which enemy a tower at `pos` with the given `range` and `mode` targets.
 * Returns null if no living enemy is in range.
 */
export function selectTarget(
  pos: Vec2,
  range: number,
  mode: TargetingMode,
  enemies: EnemyInstance[],
): EnemyInstance | null {
  let best: EnemyInstance | null = null;
  let bestScore = 0;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const d = Math.hypot(enemy.pos.x - pos.x, enemy.pos.y - pos.y);
    if (d > range) continue;

    // Higher score wins. Encode each mode as a "bigger is better" score.
    let score: number;
    switch (mode) {
      case 'first':
        score = enemy.distance;
        break;
      case 'last':
        score = -enemy.distance;
        break;
      case 'close':
        score = -d;
        break;
      case 'strong':
        score = enemy.hp;
        break;
    }

    if (best === null || score > bestScore) {
      best = enemy;
      bestScore = score;
    }
  }

  return best;
}

export function combatSystem(ctx: SystemContext): void {
  const { state, registry, dt } = ctx;

  for (const tower of state.towers) {
    if (tower.cooldown > 0) tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const def = registry.getTower(tower.type);
    if (!def) continue;

    const stats = effectiveStats(def, tower);
    const target = selectTarget(tower.pos, stats.range, tower.targeting, state.enemies);
    if (!target) {
      tower.cooldown = 0; // stay ready so we fire as soon as a target appears
      continue;
    }

    state.projectiles.push({
      id: `p${state.seq++}`,
      pos: { x: tower.pos.x, y: tower.pos.y },
      target: target.id,
      damage: stats.damage,
      speed: PROJECTILE_SPEED,
      source: tower.id,
      effects: activeEffects(def, tower),
    });

    tower.cooldown = stats.fireRate > 0 ? 1 / stats.fireRate : Infinity;
  }
}
