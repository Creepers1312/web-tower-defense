/**
 * projectileSystem — flies projectiles in a straight line and resolves hits.
 *
 * Projectiles do NOT home in on a target: each carries a fixed velocity set at
 * fire time and travels along that heading until it has popped `pops` enemies or
 * flown `maxDist`. As it passes through an enemy (within HIT_RADIUS of its travel
 * segment this tick) the firing tower's effects run — this is where damage is
 * dealt, via the `directDamage` effect. If the firing tower no longer exists
 * (e.g. it was sold mid-flight), the projectile's snapshot damage is applied
 * directly instead. Each enemy is hit at most once per projectile (`hitIds`).
 * Enemies reduced to zero hp are killed, granting their reward.
 */

import type { SystemContext } from './context.js';
import type { EnemyInstance, ProjectileInstance, TowerInstance } from '../types.js';
import { createEnemyInstance } from '../entities.js';
import { distanceToSegment } from '../placement.js';

/** Distance from a projectile's flight path within which an enemy is hit. */
export const HIT_RADIUS = 14;

/**
 * Spawn a popped enemy's children at its position. Camo/regrow are inherited so
 * a camo/regrow parent produces camo/regrow children (classic hierarchy rule).
 */
function popInto(ctx: SystemContext, parent: EnemyInstance): void {
  const { state, registry } = ctx;
  const parentDef = registry.getEnemy(parent.type);
  const children = parentDef?.children;
  if (!children) return;

  const inheritCamo = parent.flags.includes('camo');
  const inheritRegrow = parent.flags.includes('regrow');

  for (const spec of children) {
    const def = registry.getEnemy(spec.enemyId);
    if (!def) continue;
    for (let i = 0; i < spec.count; i++) {
      const child = createEnemyInstance(def, `e${state.seq++}`, parent.pos);
      // Children continue from where the parent popped.
      child.distance = parent.distance;
      if (inheritCamo && !child.flags.includes('camo')) child.flags.push('camo');
      if (inheritRegrow && !child.flags.includes('regrow')) {
        child.flags.push('regrow');
        if (child.regrowRate === 0) child.regrowRate = parent.regrowRate;
      }
      state.enemies.push(child);
    }
  }
}

/**
 * Damage a single enemy with a projectile (respecting lead), handling kills.
 * Returns true if the enemy was actually engaged (lead-immune passes fizzle so
 * the projectile keeps its pierce and flies on through).
 */
function hitEnemy(
  ctx: SystemContext,
  proj: ProjectileInstance,
  tower: TowerInstance | undefined,
  enemy: EnemyInstance,
): boolean {
  const { world, state, registry, dt, events } = ctx;

  // Lead enemies take damage only from lead-popping shots — otherwise fizzle.
  if (enemy.flags.includes('lead') && !proj.popsLead) return false;

  if (tower) {
    for (const name of proj.effects) {
      registry.getEffect(name)?.apply({ world, tower, target: enemy, dt });
    }
  } else {
    enemy.hp -= proj.damage; // firing tower gone → use the snapshot damage
  }

  if (enemy.alive && enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    state.money += enemy.reward;
    if (tower) tower.pops += 1; // credit the popping tower (Pop Count display)
    events.emit('onEnemyKilled', { enemyId: enemy.id, reward: enemy.reward });
    popInto(ctx, enemy);
  }
  return true;
}

export function projectileSystem(ctx: SystemContext): void {
  const { state, dt } = ctx;
  const survivors: ProjectileInstance[] = [];

  for (const proj of state.projectiles) {
    const from = proj.pos;
    const to = { x: proj.pos.x + proj.vel.x * dt, y: proj.pos.y + proj.vel.y * dt };
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    const tower = state.towers.find((t) => t.id === proj.source);

    // Pop every not-yet-hit enemy the flight segment grazes this tick, nearest
    // first, until the projectile runs out of pierce.
    const candidates = state.enemies
      .filter((e) => e.alive && !proj.hitIds.includes(e.id))
      .map((e) => ({ e, d: distanceToSegment(e.pos, from, to) }))
      .filter((o) => o.d <= HIT_RADIUS)
      .sort((a, b) => a.d - b.d);

    for (const { e } of candidates) {
      if (proj.pops <= 0) break;
      if (!hitEnemy(ctx, proj, tower, e)) continue; // lead-immune → pass through
      proj.hitIds.push(e.id);
      proj.pops -= 1;
    }

    proj.pos = to;
    proj.traveled += step;
    if (proj.pops > 0 && proj.traveled < proj.maxDist) survivors.push(proj);
  }

  state.projectiles = survivors;
}
