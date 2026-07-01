/**
 * movementSystem — advances enemies along the map path.
 *
 * Moves every living enemy by `speed * dt`, updates its cached position and
 * current segment, and handles "leaking" (reaching the end of the path): the
 * player loses lives, an `onEnemyLeaked` event is emitted, and the enemy is
 * marked dead (removed later by the cleanup system). If lives reach zero the
 * game transitions to the 'lost' phase.
 */

import type { SystemContext } from './context.js';
import { progressAlongPath } from '../path.js';

export function movementSystem(ctx: SystemContext): void {
  const { state, map, dt, events } = ctx;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    enemy.distance += enemy.speed * dt;
    const progress = progressAlongPath(map.path, enemy.distance);
    enemy.pos = progress.pos;
    enemy.pathIndex = progress.segment;

    if (progress.done) {
      enemy.alive = false;
      state.lives -= enemy.leakDamage;
      events.emit('onEnemyLeaked', { enemyId: enemy.id, leakDamage: enemy.leakDamage });
      if (state.lives <= 0) {
        state.lives = 0;
        state.phase = 'lost';
      }
    }
  }
}
