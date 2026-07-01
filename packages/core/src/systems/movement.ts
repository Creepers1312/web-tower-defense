/**
 * movementSystem — the only gameplay system implemented in Milestone 1.
 *
 * Advances every living enemy along the map path by `speed * dt`, updates its
 * cached position and current segment, and handles "leaking" (reaching the end
 * of the path). Leaked enemies are removed from the state and announced via the
 * event bus so downstream systems (economy, UI) can react without this system
 * knowing about them.
 */

import type { EventBus } from '../events.js';
import type { GameState, MapDef } from '../types.js';
import { progressAlongPath } from '../path.js';

export interface MovementContext {
  state: GameState;
  map: MapDef;
  /** Fixed timestep in seconds. */
  dt: number;
  events: EventBus;
}

export function movementSystem(ctx: MovementContext): void {
  const { state, map, dt, events } = ctx;
  let leaked = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    enemy.distance += enemy.speed * dt;
    const progress = progressAlongPath(map.path, enemy.distance);
    enemy.pos = progress.pos;
    enemy.pathIndex = progress.segment;

    if (progress.done) {
      enemy.alive = false;
      leaked = true;
      events.emit('onEnemyLeaked', {
        enemyId: enemy.id,
        leakDamage: enemy.leakDamage,
      });
    }
  }

  // Compact the array only when something actually left the field.
  if (leaked) {
    state.enemies = state.enemies.filter((e) => e.alive);
  }
}
