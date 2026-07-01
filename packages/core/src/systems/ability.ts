/**
 * abilitySystem — counts down each tower's activated-ability timers.
 *
 * Two independent clocks live on every tower instance:
 *   - `abilityActive`   seconds of buff remaining (0 = the buff is not running).
 *   - `abilityCooldown` seconds until the ability can be triggered again.
 *
 * Triggering is done via the `ActivateAbility` command (see commands.ts); this
 * system merely lets both clocks run down at the fixed timestep. The buff itself
 * is applied where stats are read (combatSystem / directDamage) via `abilityBuff`.
 */

import type { SystemContext } from './context.js';

export function abilitySystem(ctx: SystemContext): void {
  const { state, dt } = ctx;
  for (const tower of state.towers) {
    if (tower.abilityActive > 0) tower.abilityActive = Math.max(0, tower.abilityActive - dt);
    if (tower.abilityCooldown > 0) tower.abilityCooldown = Math.max(0, tower.abilityCooldown - dt);
  }
}
