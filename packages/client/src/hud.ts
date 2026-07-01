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
  towerAbility,
  SELL_REFUND_RATE,
  type Registry,
  type TargetingMode,
  type TowerInstance,
  type Vec2,
  type World,
} from '@td/core';
import type { PixiRenderer, RenderView } from './PixiRenderer.js';

/** Pixel radius used for click-selecting a placed tower. */
const TOWER_PICK_RADIUS = 16;

/** Delay before auto-wave starts the next round (lets the bonus banner show). */
const AUTO_WAVE_DELAY_MS = 900;

/** Selectable game speeds cycled by the speed button. */
const SPEEDS = [1, 2, 3] as const;

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
  private readonly pauseBtn = el<HTMLButtonElement>('pauseBtn');
  private readonly speedBtn = el<HTMLButtonElement>('speedBtn');
  private readonly autoBtn = el<HTMLButtonElement>('autoBtn');
  private readonly palette = el<HTMLElement>('palette');
  private readonly footerDefault = el<HTMLElement>('footerDefault');
  private readonly footerSelected = el<HTMLElement>('footerSelected');
  private readonly selIcon = el<HTMLImageElement>('selIcon');
  private readonly selName = el<HTMLElement>('selName');
  private readonly selStats = el<HTMLElement>('selStats');
  private readonly targeting = el<HTMLElement>('targeting');
  private readonly up0 = el<HTMLButtonElement>('up0');
  private readonly up1 = el<HTMLButtonElement>('up1');
  private readonly ability = el<HTMLButtonElement>('ability');
  private readonly sell = el<HTMLButtonElement>('sell');
  private readonly hint = el<HTMLElement>('hint');
  private readonly paletteButtons = new Map<string, HTMLButtonElement>();
  private readonly targetingButtons = Array.from(
    this.targeting.querySelectorAll<HTMLButtonElement>('button[data-mode]'),
  );

  /** Transient "round cleared" banner (shown in the hint line for a few sec). */
  private banner = '';
  private bannerUntil = 0;

  /** Cached upgrade-tile markup per path, so we only rebuild (and reset the
   *  hover tooltip) when the content actually changes. */
  private readonly upHtml: [string, string] = ['', ''];

  // --- game-loop controls (read by the loop in main.ts) ---
  private paused = false;
  private speedIndex = 0; // index into SPEEDS
  private autoWave = false;
  /** Timestamp at which auto-wave should fire the next round (0 = disarmed). */
  private autoStartAt = 0;

  constructor(
    private readonly world: World,
    private readonly registry: Registry,
    private readonly renderer: PixiRenderer,
  ) {
    this.buildPalette();
    this.wireControls();
    this.wireCanvas();
    this.world.getEvents().on('onWaveComplete', (p) => {
      this.banner = `✅ Round ${p.waveIndex + 1} cleared — bonus +$${p.bonus}`;
      this.bannerUntil = performance.now() + 3500;
    });
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

  /** Loop control state read by the game loop each frame. */
  loopState(): { paused: boolean; speed: number } {
    return { paused: this.paused, speed: SPEEDS[this.speedIndex]! };
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
    this.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
    });
    this.speedBtn.addEventListener('click', () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
    });
    this.autoBtn.addEventListener('click', () => {
      this.autoWave = !this.autoWave;
      this.autoStartAt = 0; // re-arm from a clean state
    });
    this.sell.addEventListener('click', () => {
      if (this.selectedTowerId) {
        this.world.submit({ kind: 'SellTower', towerId: this.selectedTowerId });
        this.selectedTowerId = null;
      }
    });
    for (const btn of this.targetingButtons) {
      btn.addEventListener('click', () => {
        if (this.selectedTowerId) {
          this.world.submit({
            kind: 'SetTargeting',
            towerId: this.selectedTowerId,
            mode: btn.dataset.mode as TargetingMode,
          });
        }
      });
    }
    this.up0.addEventListener('click', () => this.upgrade(0));
    this.up1.addEventListener('click', () => this.upgrade(1));
    this.ability.addEventListener('click', () => {
      if (this.selectedTowerId) {
        this.world.submit({ kind: 'ActivateAbility', towerId: this.selectedTowerId });
      }
    });
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
  }

  private upgrade(path: 0 | 1): void {
    if (this.selectedTowerId) {
      this.world.submit({ kind: 'Upgrade', towerId: this.selectedTowerId, path });
    }
  }

  /** Auto-start the next wave after a short delay while auto-wave is enabled. */
  private updateAutoWave(phase: string): void {
    const hasNextWave = this.world.getState().waveIndex < this.world.getMap().waves.length;
    if (!this.autoWave || this.paused || phase !== 'building' || !hasNextWave) {
      this.autoStartAt = 0; // disarm outside the building phase
      return;
    }
    const now = performance.now();
    if (this.autoStartAt === 0) {
      this.autoStartAt = now + AUTO_WAVE_DELAY_MS; // arm the countdown
    } else if (now >= this.autoStartAt) {
      this.world.submit({ kind: 'StartWave' });
      this.autoStartAt = 0; // re-arms next building phase; ignored once phase='wave'
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

    // Loop-control buttons.
    this.pauseBtn.textContent = this.paused ? '▶ Resume' : '⏸ Pause';
    this.pauseBtn.classList.toggle('active', this.paused);
    this.speedBtn.textContent = `${SPEEDS[this.speedIndex]}×`;
    this.speedBtn.classList.toggle('active', SPEEDS[this.speedIndex]! > 1);
    this.autoBtn.textContent = this.autoWave ? 'Auto: on' : 'Auto: off';
    this.autoBtn.classList.toggle('active', this.autoWave);
    this.updateAutoWave(state.phase);

    for (const [type, btn] of this.paletteButtons) {
      btn.classList.toggle('active', this.placingType === type);
    }

    if (performance.now() < this.bannerUntil) {
      this.hint.textContent = this.banner;
    } else {
      this.hint.textContent = this.placingType
        ? 'Click inside a buildable area (clear of the path) to place. Click the tower again to cancel.'
        : 'Click a tower to select it (controls appear below). Pick a tower on the right to start placing.';
    }

    this.refreshSelected();
  }

  private refreshSelected(): void {
    const tower = this.selectedTowerId
      ? this.world.getState().towers.find((t) => t.id === this.selectedTowerId)
      : undefined;
    const def = tower ? this.registry.getTower(tower.type) : undefined;
    if (!tower || !def) {
      // No selection: show the default (agents) view; footer height is unchanged.
      this.footerDefault.style.display = 'flex';
      this.footerSelected.style.display = 'none';
      return;
    }
    this.footerDefault.style.display = 'none';
    this.footerSelected.style.display = 'flex';

    // Portrait + name + one-line stats.
    const sprite = this.currentSprite(def, tower);
    if (sprite) {
      this.selIcon.src = `/sprites/${sprite}.png`;
      this.selIcon.style.visibility = 'visible';
    } else {
      this.selIcon.style.visibility = 'hidden';
    }
    const s = effectiveStats(def, tower);
    const caps = towerCapabilities(def, tower);
    const badges: string[] = [];
    if (caps.camoDetection) badges.push('camo');
    if (caps.popsLead) badges.push('lead');
    this.selName.textContent = `${def.name}  (${tower.tiers[0]}/${tower.tiers[1]})`;
    this.selStats.textContent =
      `rng ${Math.round(s.range)} · ${s.fireRate.toFixed(1)}/s · dmg ${Math.round(s.damage)}` +
      (badges.length ? ` · ${badges.join(' ')}` : '');

    // Segmented targeting: highlight the active mode.
    for (const btn of this.targetingButtons) {
      btn.classList.toggle('active', btn.dataset.mode === tower.targeting);
    }

    this.applyUpgradeButton(this.up0, def, tower, 0);
    this.applyUpgradeButton(this.up1, def, tower, 1);

    const ability = towerAbility(def, tower);
    if (!ability) {
      this.ability.style.display = 'none';
    } else {
      this.ability.style.display = 'inline-block';
      if (tower.abilityActive > 0) {
        this.ability.textContent = `⚡ ${ability.name}: active ${Math.ceil(tower.abilityActive)}s`;
        this.ability.disabled = true;
      } else if (tower.abilityCooldown > 0) {
        this.ability.textContent = `⚡ ${ability.name}: ${Math.ceil(tower.abilityCooldown)}s`;
        this.ability.disabled = true;
      } else {
        this.ability.textContent = `⚡ ${ability.name}: ready`;
        this.ability.disabled = false;
      }
    }

    this.sell.textContent = `Sell $${this.sellValue(def, tower)}`;
  }

  /** Highest reached upgrade tier sprite (deep path drives the look), else base. */
  private currentSprite(
    def: NonNullable<ReturnType<Registry['getTower']>>,
    tower: TowerInstance,
  ): string | undefined {
    let bestIdx = -1;
    let best = def.sprite;
    for (let p = 0 as 0 | 1; p <= 1; p = (p + 1) as 0 | 1) {
      const level = tower.tiers[p];
      for (let t = 0; t < level; t++) {
        const sprite = def.paths[p].tiers[t].sprite;
        if (sprite && t > bestIdx) {
          bestIdx = t;
          best = sprite;
        }
      }
    }
    return best;
  }

  /** Refund value shown on the Sell button (mirrors the core reducer). */
  private sellValue(
    def: NonNullable<ReturnType<Registry['getTower']>>,
    tower: TowerInstance,
  ): number {
    let invested = def.cost;
    for (let p = 0 as 0 | 1; p <= 1; p = (p + 1) as 0 | 1) {
      for (let t = 0; t < tower.tiers[p]; t++) invested += def.paths[p].tiers[t].cost;
    }
    return Math.floor(invested * SELL_REFUND_RATE);
  }

  private applyUpgradeButton(
    btn: HTMLButtonElement,
    def: NonNullable<ReturnType<Registry['getTower']>>,
    tower: TowerInstance,
    path: 0 | 1,
  ): void {
    const level = tower.tiers[path];
    const pips = [0, 1, 2, 3].map((i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const pipsHtml = `<span class="up-pips">${pips}</span>`;

    let cls = 'up-tile';
    let disabled = false;
    let html: string;

    if (level >= 4) {
      cls = 'up-tile maxed';
      disabled = true;
      html =
        `${pipsHtml}${this.tierIcon(this.currentSprite(def, tower))}` +
        `<span class="up-cost">MAX</span>` +
        `<span class="up-tip"><b>Path ${path + 1}</b><br>Fully upgraded</span>`;
    } else {
      const tier = def.paths[path].tiers[level];
      const can = canUpgrade(tower, path);
      const affordable = this.world.getState().money >= tier.cost;
      const icon = this.tierIcon(tier.sprite ?? def.sprite);
      if (!can) {
        cls = 'up-tile locked';
        disabled = true;
        html =
          `${pipsHtml}${icon}<span class="up-cost">🔒</span>` +
          `<span class="up-tip"><b>${tier.name}</b><br>Path locked — only one path may go past tier 2` +
          `<br><span class="up-tip-cost">$${tier.cost}</span></span>`;
      } else {
        disabled = !affordable;
        html =
          `${pipsHtml}${icon}<span class="up-cost">$${tier.cost}</span>` +
          `<span class="up-tip"><b>${tier.name}</b><br>${this.describeTier(tier)}` +
          `<br><span class="up-tip-cost">$${tier.cost}</span></span>`;
      }
    }

    btn.className = cls;
    btn.disabled = disabled;
    // Only touch innerHTML when it changed, so hovering the tooltip stays stable.
    if (this.upHtml[path] !== html) {
      btn.innerHTML = html;
      this.upHtml[path] = html;
    }
  }

  /** Small icon markup for an upgrade tile (a tier/tower sprite, else a glyph). */
  private tierIcon(sprite: string | undefined): string {
    return sprite
      ? `<img class="up-ic" src="/sprites/${sprite}.png" alt="">`
      : `<span class="up-ic" style="text-align:center;font-size:18px;line-height:26px">▲</span>`;
  }

  /** Human-readable summary of what an upgrade tier does (from its data). */
  private describeTier(tier: NonNullable<ReturnType<Registry['getTower']>>['paths'][0]['tiers'][0]): string {
    const parts: string[] = [];
    const m = tier.modifiers;
    const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
    if (m.range) parts.push(`${signed(m.range)} range`);
    if (m.fireRate) parts.push(`${signed(m.fireRate)}/s fire rate`);
    if (m.damage) parts.push(`${signed(m.damage)} damage`);
    if (m.pierce) parts.push(`${signed(m.pierce)} pierce`);
    if (m.shots) parts.push(`${signed(m.shots)} extra dart${Math.abs(m.shots) === 1 ? '' : 's'}`);
    if (tier.grants?.camoDetection) parts.push('detects camo');
    if (tier.grants?.popsLead) parts.push('pops lead');
    if (tier.ability) parts.push(`activated: ${tier.ability.name}`);
    return parts.length ? parts.join(' · ') : 'Upgrade';
  }
}
