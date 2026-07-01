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
import type { EnemyInstance, ProjectileInstance } from '../types.js';

/** Distance at which a projectile is considered to have hit its target. */
export const HIT_RADIUS = 10;

function resolveImpact(ctx: SystemContext, proj: ProjectileInstance, target: EnemyInstance): void {
  const { world, state, registry, dt, events } = ctx;

  const tower = state.towers.find((t) => t.id === proj.source);
  if (tower) {
    for (const name of proj.effects) {
      registry.getEffect(name)?.apply({ world, tower, target, dt });
    }
  } else {
    // Firing tower is gone — fall back to the damage snapshot taken at fire time.
    target.hp -= proj.damage;
  }

  if (target.alive && target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    state.money += target.reward;
    events.emit('onEnemyKilled', { enemyId: target.id, reward: target.reward });
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
