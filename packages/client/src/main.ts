/**
 * Client entry point.
 *
 * Wires the data-driven registry, the simulation `World`, the `PixiRenderer`,
 * and the `Hud`, then runs a fixed-timestep game loop:
 *   - simulation advances in fixed 1/60 s steps (deterministic),
 *   - rendering + HUD refresh happen once per animation frame.
 */

import { Registry, World, registerBuiltinEffects } from '@td/core';
import { contentAddon, DEFAULT_MAP_ID } from '@td/content';
import { PixiRenderer } from './PixiRenderer.js';
import { Hud } from './hud.js';

async function main(): Promise<void> {
  const registry = new Registry();
  registerBuiltinEffects(registry);
  registry.use(contentAddon);

  const world = new World(registry, DEFAULT_MAP_ID);

  const mount = document.getElementById('app');
  if (!mount) throw new Error('Missing #app mount element');
  const renderer = new PixiRenderer(world, registry);
  await renderer.init(mount);

  const hud = new Hud(world, registry, renderer);

  // Fixed-timestep loop with an accumulator.
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
    renderer.render(hud.view());
    hud.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void main();
