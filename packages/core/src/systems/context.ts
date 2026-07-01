/**
 * Shared context passed to every simulation system on each fixed tick.
 *
 * Bundling these together keeps system signatures uniform and lets systems that
 * need the registry or the world (for effect resolution) reach them without
 * threading extra parameters everywhere.
 */

import type { World } from '../world.js';
import type { Registry } from '../registry.js';
import type { EventBus } from '../events.js';
import type { GameState, MapDef } from '../types.js';

export interface SystemContext {
  world: World;
  state: GameState;
  registry: Registry;
  map: MapDef;
  /** Fixed timestep in seconds. */
  dt: number;
  events: EventBus;
}
