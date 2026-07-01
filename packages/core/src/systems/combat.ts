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
export const PROJECTILE_SPEED = 420;

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

/** Up to `count` distinct in-range targets, best-first by the targeting mode. */
export function selectTargets(
  pos: Vec2,
  range: number,
  mode: TargetingMode,
  enemies: EnemyInstance[],
  canSeeCamo: boolean,
  count: number,
): EnemyInstance[] {
  const inRange = enemies.filter((e) => {
    if (!e.alive) return false;
    if (!canSeeCamo && e.flags.includes('camo')) return false;
    return Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y) <= range;
  });
  const score = (e: EnemyInstance): number => {
    switch (mode) {
      case 'first':
        return e.distance;
      case 'last':
        return -e.distance;
      case 'close':
        return -Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y);
      case 'strong':
        return e.hp;
    }
  };
  inRange.sort((a, b) => score(b) - score(a));
  return inRange.slice(0, Math.max(1, count));
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
    const targets = selectTargets(
      tower.pos,
      stats.range,
      tower.targeting,
      state.enemies,
      caps.camoDetection,
      Math.max(1, Math.round(stats.shots)),
    );
    if (targets.length === 0) {
      tower.cooldown = 0; // stay ready so we fire as soon as a target appears
      continue;
    }

    // Fire `shots` projectiles; if fewer distinct targets, extra shots repeat
    // onto the primary target.
    const shots = Math.max(1, Math.round(stats.shots));
    const effects = activeEffects(def, tower);
    for (let i = 0; i < shots; i++) {
      const target = targets[i % targets.length]!;
      state.projectiles.push({
        id: `p${state.seq++}`,
        pos: { x: tower.pos.x, y: tower.pos.y },
        target: target.id,
        damage: stats.damage,
        speed: PROJECTILE_SPEED,
        source: tower.id,
        effects,
        popsLead: caps.popsLead,
        pierce: Math.max(0, Math.round(stats.pierce)),
      });
    }

    tower.cooldown = stats.fireRate > 0 ? 1 / stats.fireRate : Infinity;
  }
}
