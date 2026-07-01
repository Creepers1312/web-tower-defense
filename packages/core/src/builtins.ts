/**
 * Registers the effects that ship with the core engine. Content packages can
 * reference these by name, and add their own effects via the same registry.
 */

import type { Registry } from './registry.js';
import { directDamage, multishot, pierce } from './effects.js';

export function registerBuiltinEffects(reg: Registry): void {
  reg.registerEffect('directDamage', directDamage);
  reg.registerEffect('pierce', pierce);
  reg.registerEffect('multishot', multishot);
}
