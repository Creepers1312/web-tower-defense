/**
 * spawnSystem — releases the current wave's enemies over time.
 *
 * While the game is in the 'wave' phase, this advances a per-wave clock
 * (`state.waveTime`) and spawns each wave entry's enemies according to its
 * `delay` (seconds before the first spawn) and `spacing` (seconds between
 * spawns). `state.spawned[i]` tracks how many of entry `i` have been released so
 * spawning is deterministic and resumable from the serialised state.
 */

import type { SystemContext } from './context.js';
import type { WaveEntry } from '../types.js';
import { createEnemyInstance } from '../entities.js';

/** How many of `entry` should have spawned by `waveTime` seconds. */
function dueCount(entry: WaveEntry, waveTime: number): number {
  if (waveTime < entry.delay) return 0;
  if (entry.spacing <= 0) return entry.count; // all at once
  const elapsed = waveTime - entry.delay;
  return Math.min(entry.count, Math.floor(elapsed / entry.spacing) + 1);
}

export function spawnSystem(ctx: SystemContext): void {
  const { state, map, registry, dt } = ctx;
  if (state.phase !== 'wave') return;

  const wave = map.waves[state.waveIndex];
  if (!wave) return;

  state.waveTime += dt;

  const start = map.path[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < wave.entries.length; i++) {
    const entry = wave.entries[i]!;
    const due = dueCount(entry, state.waveTime);
    while ((state.spawned[i] ?? 0) < due) {
      const def = registry.getEnemy(entry.enemyId);
      // Skip unknown enemy ids but still advance the counter so we don't loop.
      if (def) {
        state.enemies.push(createEnemyInstance(def, `e${state.seq++}`, start));
      }
      state.spawned[i] = (state.spawned[i] ?? 0) + 1;
    }
  }
}
