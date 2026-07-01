/**
 * Hud — DOM overlay and input controller.
 *
 * Reads the read-only world state to refresh the on-screen stats and the
 * selected-tower panel, and translates user input (palette clicks, canvas
 * clicks, upgrade/sell/targeting controls) into Commands submitted to the world.
 * It never mutates state directly.
 */

import {
  canPlaceTower,
  canUpgrade,
  effectiveStats,
  towerCapabilities,
  type Registry,
  type TargetingMode,
  type TowerInstance,
  type Vec2,
  type World,
} from '@td/core';
import type { PixiRenderer, RenderView } from './PixiRenderer.js';

/** Pixel radius used for click-selecting a placed tower. */
const TOWER_PICK_RADIUS = 16;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export class Hud {
  private placingType: string | null = null;
  private selectedTowerId: string | null = null;
  private ghost: { pos: Vec2; valid: boolean } | null = null;

  // DOM refs
  private readonly money = el<HTMLElement>('money');
  private readonly lives = el<HTMLElement>('lives');
  private readonly wave = el<HTMLElement>('wave');
  private readonly phase = el<HTMLElement>('phase');
  private readonly startWave = el<HTMLButtonElement>('startWave');
  private readonly palette = el<HTMLElement>('palette');
  private readonly selectedPanel = el<HTMLElement>('selectedPanel');
  private readonly selectedInfo = el<HTMLElement>('selectedInfo');
  private readonly targeting = el<HTMLSelectElement>('targeting');
  private readonly up0 = el<HTMLButtonElement>('up0');
  private readonly up1 = el<HTMLButtonElement>('up1');
  private readonly sell = el<HTMLButtonElement>('sell');
  private readonly hint = el<HTMLElement>('hint');
  private readonly paletteButtons = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly world: World,
    private readonly registry: Registry,
    private readonly renderer: PixiRenderer,
  ) {
    this.buildPalette();
    this.wireControls();
    this.wireCanvas();
  }

  /** Highlight info consumed by the renderer each frame. */
  view(): RenderView {
    let placing: RenderView['placing'] = null;
    if (this.placingType && this.ghost) {
      const def = this.registry.getTower(this.placingType);
      placing = { pos: this.ghost.pos, range: def?.range ?? 0, valid: this.ghost.valid };
    }
    return { selectedTowerId: this.selectedTowerId, placing };
  }

  // --- setup --------------------------------------------------------------

  private buildPalette(): void {
    for (const def of this.registry.allTowers()) {
      const btn = document.createElement('button');
      const icon = def.sprite
        ? `<img class="hud-icon" src="/sprites/${def.sprite}.png" alt="" />`
        : '';
      btn.innerHTML = `${icon}<span>${def.name} — $${def.cost}</span>`;
      btn.addEventListener('click', () => this.togglePlacing(def.id));
      this.palette.appendChild(btn);
      this.paletteButtons.set(def.id, btn);
    }
  }

  private wireControls(): void {
    this.startWave.addEventListener('click', () => this.world.submit({ kind: 'StartWave' }));
    this.sell.addEventListener('click', () => {
      if (this.selectedTowerId) {
        this.world.submit({ kind: 'SellTower', towerId: this.selectedTowerId });
        this.selectedTowerId = null;
      }
    });
    this.targeting.addEventListener('change', () => {
      if (this.selectedTowerId) {
        this.world.submit({
          kind: 'SetTargeting',
          towerId: this.selectedTowerId,
          mode: this.targeting.value as TargetingMode,
        });
      }
    });
    this.up0.addEventListener('click', () => this.upgrade(0));
    this.up1.addEventListener('click', () => this.upgrade(1));
  }

  private wireCanvas(): void {
    const canvas = this.renderer.canvas;
    canvas.addEventListener('mousemove', (e) => {
      if (!this.placingType) {
        this.ghost = null;
        return;
      }
      const pos = this.renderer.screenToWorld(e.clientX, e.clientY);
      this.ghost = { pos, valid: this.canPlaceHere(this.placingType, pos) };
    });
    canvas.addEventListener('mouseleave', () => {
      this.ghost = null;
    });
    canvas.addEventListener('click', (e) => {
      const pos = this.renderer.screenToWorld(e.clientX, e.clientY);
      if (this.placingType) {
        if (this.canPlaceHere(this.placingType, pos)) {
          this.world.submit({ kind: 'PlaceTower', type: this.placingType, pos });
        }
        return;
      }
      this.selectTowerAt(pos);
    });
  }

  // --- input helpers ------------------------------------------------------

  private togglePlacing(type: string): void {
    this.placingType = this.placingType === type ? null : type;
    this.selectedTowerId = null;
    this.ghost = null;
  }

  private canPlaceHere(type: string, pos: Vec2): boolean {
    const def = this.registry.getTower(type);
    if (!def) return false;
    const state = this.world.getState();
    return state.money >= def.cost && canPlaceTower(this.world.getMap(), pos, state.towers);
  }

  private selectTowerAt(pos: Vec2): void {
    let picked: TowerInstance | null = null;
    let bestDist = TOWER_PICK_RADIUS;
    for (const t of this.world.getState().towers) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.y - pos.y);
      if (d <= bestDist) {
        picked = t;
        bestDist = d;
      }
    }
    this.selectedTowerId = picked ? picked.id : null;
    if (picked) this.targeting.value = picked.targeting;
  }

  private upgrade(path: 0 | 1): void {
    if (this.selectedTowerId) {
      this.world.submit({ kind: 'Upgrade', towerId: this.selectedTowerId, path });
    }
  }

  // --- per-frame DOM refresh ---------------------------------------------

  update(): void {
    const state = this.world.getState();
    this.money.textContent = String(state.money);
    this.lives.textContent = String(state.lives);
    this.wave.textContent = String(state.waveIndex + 1);
    this.phase.textContent = state.phase;
    this.startWave.disabled = state.phase !== 'building';

    for (const [type, btn] of this.paletteButtons) {
      btn.classList.toggle('active', this.placingType === type);
    }

    this.hint.textContent = this.placingType
      ? 'Click inside a buildable area (clear of the path) to place. Click the tower again to cancel.'
      : 'Click a tower to select it. Pick a tower on the right to start placing.';

    this.refreshSelected();
  }

  private refreshSelected(): void {
    const tower = this.selectedTowerId
      ? this.world.getState().towers.find((t) => t.id === this.selectedTowerId)
      : undefined;
    if (!tower) {
      this.selectedPanel.style.display = 'none';
      return;
    }
    const def = this.registry.getTower(tower.type);
    if (!def) {
      this.selectedPanel.style.display = 'none';
      return;
    }
    this.selectedPanel.style.display = 'block';

    const s = effectiveStats(def, tower);
    const caps = towerCapabilities(def, tower);
    const camo = caps.camoDetection ? '✓' : '✗';
    const lead = caps.popsLead ? '✓' : '✗';
    this.selectedInfo.innerHTML =
      `<b>${def.name}</b> · tiers ${tower.tiers[0]}/${tower.tiers[1]}<br>` +
      `range ${Math.round(s.range)} · rate ${s.fireRate.toFixed(1)}/s · dmg ${s.damage}<br>` +
      `<span class="muted">camo ${camo} · lead ${lead}</span>`;

    if (this.targeting.value !== tower.targeting) this.targeting.value = tower.targeting;

    this.applyUpgradeButton(this.up0, def, tower, 0);
    this.applyUpgradeButton(this.up1, def, tower, 1);
  }

  private applyUpgradeButton(
    btn: HTMLButtonElement,
    def: NonNullable<ReturnType<Registry['getTower']>>,
    tower: TowerInstance,
    path: 0 | 1,
  ): void {
    const level = tower.tiers[path];
    if (level >= 4) {
      btn.textContent = `Path ${path + 1}: maxed`;
      btn.disabled = true;
      return;
    }
    const tier = def.paths[path].tiers[level];
    const can = canUpgrade(tower, path);
    const affordable = this.world.getState().money >= tier.cost;
    btn.textContent = `▲ ${tier.name} — $${tier.cost}`;
    btn.disabled = !can || !affordable;
  }
}
