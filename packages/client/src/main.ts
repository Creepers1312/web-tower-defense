/**
 * Client entry point.
 *
 * Menu flow: Title -> Track select -> Difficulty -> Game. On win/loss a game-over
 * overlay appears; its button reloads back to the title.
 */

import { Registry, World, registerBuiltinEffects } from '@td/core';
import type { MapDef, WorldOptions } from '@td/core';
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

/** A small SVG thumbnail of a map's track, drawn from its real path data. */
function mapPreviewSvg(map: MapDef): string {
  const pts = map.path.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    `<svg viewBox="0 0 800 660" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="800" height="660" fill="#5a9a3f"/>` +
    `<polyline points="${pts}" fill="none" stroke="#4a7c34" stroke-width="46" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<polyline points="${pts}" fill="none" stroke="#e6d5a3" stroke-width="34" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  );
}

async function main(): Promise<void> {
  const registry = new Registry();
  registerBuiltinEffects(registry);
  registry.use(contentAddon);

  const startMenu = el('startMenu');
  const steps = Array.from(startMenu.querySelectorAll<HTMLElement>('.menu-step'));
  const showStep = (name: string): void => {
    for (const s of steps) s.style.display = s.dataset.step === name ? 'block' : 'none';
  };

  let difficulty: Difficulty = 'easy';
  let selectedMap: MapDef = registry.allMaps()[0]!;

  el<HTMLButtonElement>('toTrack').addEventListener('click', () => showStep('track'));
  for (const b of startMenu.querySelectorAll<HTMLButtonElement>('button[data-back]')) {
    b.addEventListener('click', () => showStep(b.dataset.back ?? 'title'));
  }

  // Track-select grid with a preview per map.
  const grid = el('trackGrid');
  for (const m of registry.allMaps()) {
    const card = document.createElement('button');
    card.className = 'track-card';
    card.innerHTML = `<div class="track-thumb">${mapPreviewSvg(m)}</div><span>${m.name}</span>`;
    card.addEventListener('click', () => {
      selectedMap = m;
      el('diffMapName').textContent = m.name;
      el('diffPreview').innerHTML = mapPreviewSvg(m);
      showStep('difficulty');
    });
    grid.appendChild(card);
  }

  const diffRow = el('difficultyRow');
  for (const btn of diffRow.querySelectorAll<HTMLButtonElement>('button[data-diff]')) {
    btn.addEventListener('click', () => {
      difficulty = btn.dataset.diff as Difficulty;
      for (const b of diffRow.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    });
  }

  el<HTMLButtonElement>('playBtn').addEventListener('click', () => {
    startMenu.style.display = 'none';
    void startGame(registry, selectedMap.id, DIFFICULTIES[difficulty]);
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
