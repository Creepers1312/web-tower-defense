/**
 * waveSystem — end-of-tick bookkeeping.
 *
 * 1. Compacts the enemy list, dropping everything killed or leaked this tick.
 * 2. Detects wave completion: once every scheduled enemy has spawned and none
 *    remain alive, emits `onWaveComplete` and either advances to the next wave
 *    (back to the 'building' phase) or, if that was the last wave, wins the game.
 *
 * Runs after movement/combat/projectile so it sees the final state of the tick.
 */

import type { SystemContext } from './context.js';

/** Money awarded when a wave is cleared: base + step × (0-based) wave index. */
export const ROUND_BONUS_BASE = 100;
export const ROUND_BONUS_STEP = 25;

/** The cash bonus for clearing the wave at the given 0-based index. */
export function roundBonus(waveIndex: number): number {
  return ROUND_BONUS_BASE + waveIndex * ROUND_BONUS_STEP;
}

export function waveSystem(ctx: SystemContext): void {
  const { state, map, events } = ctx;

  // 1. cleanup
  if (state.enemies.some((e) => !e.alive)) {
    state.enemies = state.enemies.filter((e) => e.alive);
  }

  if (state.phase !== 'wave') return;

  // 2. completion check
  const wave = map.waves[state.waveIndex];
  if (!wave) return;

  const totalCount = wave.entries.reduce((sum, e) => sum + e.count, 0);
  const spawnedTotal = state.spawned.reduce((sum, n) => sum + n, 0);
  const allSpawned = spawnedTotal >= totalCount;

  if (allSpawned && state.enemies.length === 0) {
    const bonus = roundBonus(state.waveIndex);
    state.money += bonus;
    events.emit('onWaveComplete', { waveIndex: state.waveIndex, bonus });

    if (state.waveIndex + 1 < map.waves.length) {
      state.waveIndex += 1;
      state.phase = 'building';
      state.waveTime = 0;
      state.spawned = [];
    } else {
      state.phase = 'won';
    }
  }
}
