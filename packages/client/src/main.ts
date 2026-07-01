/**
 * Client entry point.
 *
 * Wires together the data-driven registry, the simulation `World` and the
 * `PixiRenderer`, then runs a fixed-timestep game loop:
 *
 *   - The simulation advances in fixed 1/60 s steps (deterministic).
 *   - Rendering happens once per animation frame, decoupled from the sim.
 *
 * Milestone 1 goal: exactly one enemy visibly walks the map path.
 */

import { Registry, World, registerBuiltinEffects } from '@td/core';
import { contentAddon, DEFAULT_ENEMY_ID, DEFAULT_MAP_ID } from '@td/content';
import { PixiRenderer } from './PixiRenderer.js';

async function main(): Promise<void> {
  // 1. Build the registry from core built-ins + content addon (data-driven).
  const registry = new Registry();
  registerBuiltinEffects(registry);
  registry.use(contentAddon);

  // 2. Create the world on the example map and seed the single demo enemy.
  const world = new World(registry, DEFAULT_MAP_ID);
  world.spawnEnemy(DEFAULT_ENEMY_ID);

  // 3. Set up rendering.
  const mount = document.getElementById('app');
  if (!mount) throw new Error('Missing #app mount element');
  const renderer = new PixiRenderer(world);
  await renderer.init(mount);

  // 4. Fixed-timestep loop with an accumulator.
  const STEP_MS = World.TIMESTEP * 1000;
  const MAX_FRAME_MS = 250; // clamp to avoid a spiral of death after tab stalls
  let previous = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    accumulator += Math.min(now - previous, MAX_FRAME_MS);
    previous = now;

    while (accumulator >= STEP_MS) {
      world.step();
      accumulator -= STEP_MS;
    }

    renderer.render();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void main();
