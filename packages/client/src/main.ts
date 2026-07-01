/**
 * Client entry point.
 *
 * Shows a start menu (difficulty + map), then runs the game with a fixed-timestep
 * loop. When the game is won or lost, a game-over overlay appears; its button
 * reloads back to the menu.
 */

import { Registry, World, registerBuiltinEffects } from '@td/core';
import type { WorldOptions } from '@td/core';
import { contentAddon } from '@td/content';
import { PixiRenderer } from './PixiRenderer.js';
import { Hud } from './hud.js';

type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTIES: Record<Difficulty, WorldOptions> = {
  easy: { startMoney: 750, startLives: 200 },
  medium: { startMoney: 650, startLives: 100 },
  hard: { startMoney: 500, startLives: 60 },
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

async function main(): Promise<void> {
  const registry = new Registry();
  registerBuiltinEffects(registry);
  registry.use(contentAddon);

  const startMenu = el('startMenu');
  const diffRow = el('difficultyRow');
  const mapRow = el('mapRow');

  let difficulty: Difficulty = 'easy';
  let mapId = registry.allMaps()[0]?.id ?? '';

  for (const btn of diffRow.querySelectorAll<HTMLButtonElement>('button[data-diff]')) {
    btn.addEventListener('click', () => {
      difficulty = btn.dataset.diff as Difficulty;
      for (const b of diffRow.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    });
  }

  for (const m of registry.allMaps()) {
    const btn = document.createElement('button');
    btn.textContent = m.name;
    if (m.id === mapId) btn.classList.add('active');
    btn.addEventListener('click', () => {
      mapId = m.id;
      for (const b of mapRow.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    });
    mapRow.appendChild(btn);
  }

  el<HTMLButtonElement>('playBtn').addEventListener('click', () => {
    startMenu.style.display = 'none';
    void startGame(registry, mapId, DIFFICULTIES[difficulty]);
  });
}

async function startGame(registry: Registry, mapId: string, options: WorldOptions): Promise<void> {
  const world = new World(registry, mapId, options);

  const mount = el('app');
  const renderer = new PixiRenderer(world, registry);
  await renderer.init(mount);
  const hud = new Hud(world, registry, renderer);

  const gameOver = el('gameOver');
  const goTitle = el('goTitle');
  const goMsg = el('goMsg');
  el<HTMLButtonElement>('goBtn').addEventListener('click', () => location.reload());

  const STEP_MS = World.TIMESTEP * 1000;
  const MAX_FRAME_MS = 250; // clamp to avoid a spiral of death after tab stalls
  const MAX_STEPS_PER_FRAME = 600;
  let previous = performance.now();
  let accumulator = 0;
  let ended = false;

  const frame = (now: number): void => {
    const delta = Math.min(now - previous, MAX_FRAME_MS);
    previous = now;
    const { paused, speed } = hud.loopState();
    if (!paused && !ended) {
      accumulator += delta * speed; // speed scales simulated time
      let steps = 0;
      while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        world.step();
        accumulator -= STEP_MS;
        steps++;
      }
    }
    renderer.render(hud.view());
    hud.update();

    const state = world.getState();
    if (!ended && (state.phase === 'won' || state.phase === 'lost')) {
      ended = true;
      const won = state.phase === 'won';
      goTitle.textContent = won ? '🏆 Victory!' : '💀 Game Over';
      goMsg.textContent = won
        ? `You cleared all ${state.waveIndex + 1} rounds with ${state.lives} lives left.`
        : `A Nallon leaked through on round ${state.waveIndex + 1}.`;
      gameOver.style.display = 'flex';
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
