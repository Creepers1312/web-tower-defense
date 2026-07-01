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
import { progressAlongPath } from '../path.js';

/** Speed of fired projectiles, in world units per second. */
export const PROJECTILE_SPEED = 560;

/** Angular gap (radians) between darts of a multi-shot fan (~8°). */
export const SHOT_SPREAD = 0.14;

/** Extra distance beyond the aim point a dart keeps flying before expiring. */
export const PROJECTILE_RANGE_MARGIN = 60;

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

/**
 * Predict where to aim so a straight, finite-speed dart intercepts a moving
 * enemy. Enemies advance purely by `distance += speed*dt` along the map path, so
 * the future position is the exact path point at the projected distance; we
 * fixed-point iterate the flight time a few times to converge on the intercept.
 * A stationary enemy (speed 0) resolves to its current position (no lead).
 */
export function predictAim(
  towerPos: Vec2,
  enemy: EnemyInstance,
  path: Vec2[],
  projectileSpeed: number,
): Vec2 {
  if (projectileSpeed <= 0) return enemy.pos;
  let t = Math.hypot(enemy.pos.x - towerPos.x, enemy.pos.y - towerPos.y) / projectileSpeed;
  for (let i = 0; i < 4; i++) {
    const future = progressAlongPath(path, enemy.distance + enemy.speed * t).pos;
    t = Math.hypot(future.x - towerPos.x, future.y - towerPos.y) / projectileSpeed;
  }
  return progressAlongPath(path, enemy.distance + enemy.speed * t).pos;
}

export function combatSystem(ctx: SystemContext): void {
  const { state, registry, map, dt } = ctx;

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

    // Lead the target: aim where it will be when the dart arrives, not where it
    // is now (straight darts otherwise trail fast movers and miss).
    const aim = predictAim(tower.pos, target, map.path, PROJECTILE_SPEED);
    const baseAngle = Math.atan2(aim.y - tower.pos.y, aim.x - tower.pos.x);
    const shots = Math.max(1, Math.round(stats.shots));
    const pops = Math.max(1, Math.round(stats.pierce) + 1);
    const aimDist = Math.hypot(aim.x - tower.pos.x, aim.y - tower.pos.y);
    // Fly far enough to reach the (possibly led) aim point, plus a little beyond.
    const maxDist = Math.max(stats.range, aimDist) + PROJECTILE_RANGE_MARGIN;
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
