/**
 * projectileSystem — moves projectiles toward their target and resolves impacts.
 *
 * On impact, the firing tower's active effects run (this is where damage is
 * dealt, via the `directDamage` effect — abilities via composition). If the
 * firing tower no longer exists (e.g. it was sold mid-flight), the projectile's
 * snapshotted damage is applied directly instead. Enemies reduced to zero hp are
 * killed, granting their reward.
 */

import type { SystemContext } from './context.js';
import type { EnemyInstance, ProjectileInstance, TowerInstance } from '../types.js';
import { createEnemyInstance } from '../entities.js';

/** Distance at which a projectile is considered to have hit its target. */
export const HIT_RADIUS = 10;

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

/** Radius around the impact within which pierce shots also hit other enemies. */
export const PIERCE_RADIUS = 40;

/** Damage a single enemy with a projectile (respecting lead), handling kills. */
function hitEnemy(
  ctx: SystemContext,
  proj: ProjectileInstance,
  tower: TowerInstance | undefined,
  enemy: EnemyInstance,
): void {
  const { world, state, registry, dt, events } = ctx;

  // Lead enemies take damage only from lead-popping shots.
  if (enemy.flags.includes('lead') && !proj.popsLead) return;

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
    events.emit('onEnemyKilled', { enemyId: enemy.id, reward: enemy.reward });
    popInto(ctx, enemy);
  }
}

function resolveImpact(ctx: SystemContext, proj: ProjectileInstance, target: EnemyInstance): void {
  const { state } = ctx;
  const tower = state.towers.find((t) => t.id === proj.source);

  hitEnemy(ctx, proj, tower, target);

  // Pierce: also hit the nearest other enemies within the impact radius.
  if (proj.pierce > 0) {
    const others = state.enemies
      .filter((e) => e.alive && e.id !== target.id)
      .map((e) => ({ e, d: Math.hypot(e.pos.x - target.pos.x, e.pos.y - target.pos.y) }))
      .filter((o) => o.d <= PIERCE_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, proj.pierce);
    for (const { e } of others) hitEnemy(ctx, proj, tower, e);
  }
}

export function projectileSystem(ctx: SystemContext): void {
  const { state, dt } = ctx;
  const survivors: ProjectileInstance[] = [];

  for (const proj of state.projectiles) {
    const target = state.enemies.find((e) => e.id === proj.target && e.alive);
    if (!target) continue; // target already dead/gone → projectile disappears

    const dx = target.pos.x - proj.pos.x;
    const dy = target.pos.y - proj.pos.y;
    const dist = Math.hypot(dx, dy);
    const step = proj.speed * dt;

    if (dist <= step || dist <= HIT_RADIUS) {
      resolveImpact(ctx, proj, target);
      continue; // projectile consumed on hit
    }

    proj.pos = { x: proj.pos.x + (dx / dist) * step, y: proj.pos.y + (dy / dist) * step };
    survivors.push(proj);
  }

  state.projectiles = survivors;
}
