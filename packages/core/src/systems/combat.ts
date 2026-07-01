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
import { effectiveStats, activeEffects, towerCapabilities, abilityBuff } from '../upgrade.js';

/** Speed of fired projectiles, in world units per second. */
export const PROJECTILE_SPEED = 560;

/** Angular gap (radians) between darts of a multi-shot fan (~8°). */
export const SHOT_SPREAD = 0.14;

/** Extra distance beyond a tower's range a dart keeps flying before expiring. */
export const PROJECTILE_RANGE_MARGIN = 40;

/**
 * Choose which enemy a tower at `pos` with the given `range` and `mode` targets.
 * Camo enemies are invisible unless `canSeeCamo` is true. Returns null if no
 * eligible living enemy is in range.
 */
export function selectTarget(
  pos: Vec2,
  range: number,
  mode: TargetingMode,
  enemies: EnemyInstance[],
  canSeeCamo = false,
): EnemyInstance | null {
  let best: EnemyInstance | null = null;
  let bestScore = 0;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (!canSeeCamo && enemy.flags.includes('camo')) continue;
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
    // Fold in any active ability buff (multiplicative) from nearby towers.
    const buff = abilityBuff(state, (id) => registry.getTower(id), tower);
    stats.fireRate *= buff.fireRate;
    stats.damage *= buff.damage;
    stats.range *= buff.range;
    const caps = towerCapabilities(def, tower);

    // Pick one enemy to aim at; darts then fly straight along that heading.
    const target = selectTarget(tower.pos, stats.range, tower.targeting, state.enemies, caps.camoDetection);
    if (!target) {
      tower.cooldown = 0; // stay ready so we fire as soon as a target appears
      continue;
    }

    const baseAngle = Math.atan2(target.pos.y - tower.pos.y, target.pos.x - tower.pos.x);
    const shots = Math.max(1, Math.round(stats.shots));
    const pops = Math.max(1, Math.round(stats.pierce) + 1);
    const maxDist = stats.range + PROJECTILE_RANGE_MARGIN;
    const effects = activeEffects(def, tower);

    // Fire a symmetric fan of straight darts centred on the aim direction.
    for (let i = 0; i < shots; i++) {
      const angle = baseAngle + (i - (shots - 1) / 2) * SHOT_SPREAD;
      state.projectiles.push({
        id: `p${state.seq++}`,
        pos: { x: tower.pos.x, y: tower.pos.y },
        vel: { x: Math.cos(angle) * PROJECTILE_SPEED, y: Math.sin(angle) * PROJECTILE_SPEED },
        damage: stats.damage,
        source: tower.id,
        effects,
        popsLead: caps.popsLead,
        pops,
        hitIds: [],
        traveled: 0,
        maxDist,
      });
    }

    tower.cooldown = stats.fireRate > 0 ? 1 / stats.fireRate : Infinity;
  }
}
