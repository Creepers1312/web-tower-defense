/**
 * regrowSystem — regrow enemies slowly heal back to full health.
 *
 * A "regrow" enemy that has been damaged (but not popped) regenerates hp at
 * `regrowRate` per second up to its `maxHp`. Kept as its own tiny system so the
 * rule is easy to reason about and test.
 */

import type { SystemContext } from './context.js';
import type { EnemyInstance } from '../types.js';

/** Advance a single enemy's regrow by `dt` seconds (pure, in place). */
export function regrowEnemy(enemy: EnemyInstance, dt: number): void {
  if (!enemy.alive || enemy.regrowRate <= 0) return;
  if (!enemy.flags.includes('regrow')) return;
  if (enemy.hp >= enemy.maxHp) return;
  enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.regrowRate * dt);
}

export function regrowSystem(ctx: SystemContext): void {
  for (const enemy of ctx.state.enemies) {
    regrowEnemy(enemy, ctx.dt);
  }
}
