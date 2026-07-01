/**
 * PixiRenderer — reads the read-only simulation state and draws it.
 *
 * The whole rendering side of the strict simulation/rendering split: it never
 * mutates the world, only observes `world.getState()` and pushes the result into
 * PixiJS display objects. All graphics are simple placeholder shapes.
 */

import { Application, Container, Graphics } from 'pixi.js';
import { effectiveStats, type Registry, type Vec2, type World } from '@td/core';

export const VIEW_WIDTH = 800;
export const VIEW_HEIGHT = 600;

const COLORS = {
  background: 0x1e293b,
  path: 0x475569,
  enemy: 0xef4444,
  lead: 0x9ca3af,
  camoRing: 0x16a34a,
  regrowRing: 0xf472b6,
  enemyHpBg: 0x1f2937,
  enemyHp: 0x22c55e,
  tower: 0x38bdf8,
  towerSelected: 0xfacc15,
  projectile: 0xfde047,
  rangeFill: 0x38bdf8,
  placeOk: 0x22c55e,
  placeBad: 0xef4444,
} as const;

const ENEMY_RADIUS = 12;
const TOWER_RADIUS = 13;
const PATH_WIDTH = 34;

/** Parse a '#rrggbb' string to a numeric colour, falling back on error. */
function parseColor(hex: string | undefined, fallback: number): number {
  if (!hex || hex[0] !== '#') return fallback;
  const n = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(n) ? fallback : n;
}

/** What the renderer should highlight this frame (selection / placement ghost). */
export interface RenderView {
  selectedTowerId: string | null;
  placing: { pos: Vec2; range: number; valid: boolean } | null;
}

export class PixiRenderer {
  private readonly app = new Application();

  // Layers, back-to-front.
  private readonly rangeLayer = new Container();
  private readonly towerLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly ghostLayer = new Container();

  private readonly towerGfx = new Map<string, Graphics>();
  private readonly enemyGfx = new Map<string, Graphics>();
  private readonly projectileGfx = new Map<string, Graphics>();
  private readonly range = new Graphics();
  private readonly ghost = new Graphics();

  constructor(
    private readonly world: World,
    private readonly registry: Registry,
  ) {}

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      background: COLORS.background,
      antialias: true,
    });
    parent.appendChild(this.app.canvas);

    this.drawPath();
    this.rangeLayer.addChild(this.range);
    this.ghostLayer.addChild(this.ghost);
    this.app.stage.addChild(
      this.rangeLayer,
      this.towerLayer,
      this.enemyLayer,
      this.projectileLayer,
      this.ghostLayer,
    );
  }

  /** Convert a DOM mouse event position to world coordinates. */
  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    const scaleX = VIEW_WIDTH / rect.width;
    const scaleY = VIEW_HEIGHT / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  private drawPath(): void {
    const path = this.world.getMap().path;
    if (path.length < 2) return;
    const g = new Graphics();
    const first = path[0]!;
    g.moveTo(first.x, first.y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i]!.x, path[i]!.y);
    g.stroke({ width: PATH_WIDTH, color: COLORS.path, cap: 'round', join: 'round' });
    this.app.stage.addChildAt(g, 0);
  }

  render(view: RenderView): void {
    const state = this.world.getState();
    this.syncTowers(view.selectedTowerId);
    this.syncEnemies();
    this.syncProjectiles();
    this.drawRange(view);
    this.drawGhost(view);
    void state;
  }

  private syncTowers(selectedId: string | null): void {
    const towers = this.world.getState().towers;
    const seen = new Set<string>();
    for (const tower of towers) {
      seen.add(tower.id);
      let g = this.towerGfx.get(tower.id);
      if (!g) {
        g = new Graphics();
        this.towerLayer.addChild(g);
        this.towerGfx.set(tower.id, g);
      }
      const selected = tower.id === selectedId;
      g.clear();
      g.circle(0, 0, TOWER_RADIUS).fill(COLORS.tower);
      if (selected) g.circle(0, 0, TOWER_RADIUS + 3).stroke({ width: 2, color: COLORS.towerSelected });
      // A little "barrel" tick so towers read as directional placeholders.
      g.rect(-2, -TOWER_RADIUS - 4, 4, 6).fill(COLORS.tower);
      g.position.set(tower.pos.x, tower.pos.y);
    }
    this.reap(this.towerGfx, seen, this.towerLayer);
  }

  private syncEnemies(): void {
    const enemies = this.world.getState().enemies;
    const seen = new Set<string>();
    for (const enemy of enemies) {
      seen.add(enemy.id);
      let g = this.enemyGfx.get(enemy.id);
      if (!g) {
        g = new Graphics();
        this.enemyLayer.addChild(g);
        this.enemyGfx.set(enemy.id, g);
      }
      const frac = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0;
      const def = this.registry.getEnemy(enemy.type);
      const isLead = enemy.flags.includes('lead');
      const body = isLead ? COLORS.lead : parseColor(def?.color, COLORS.enemy);
      g.clear();
      g.circle(0, 0, ENEMY_RADIUS).fill(body);
      // Flag indicators: camo (green ring), regrow (pink ring).
      if (enemy.flags.includes('camo')) {
        g.circle(0, 0, ENEMY_RADIUS + 2).stroke({ width: 2, color: COLORS.camoRing });
      }
      if (enemy.flags.includes('regrow')) {
        g.circle(0, 0, ENEMY_RADIUS + 4).stroke({ width: 2, color: COLORS.regrowRing });
      }
      // HP bar above the enemy.
      const w = 22;
      g.rect(-w / 2, -ENEMY_RADIUS - 8, w, 4).fill(COLORS.enemyHpBg);
      g.rect(-w / 2, -ENEMY_RADIUS - 8, w * frac, 4).fill(COLORS.enemyHp);
      g.position.set(enemy.pos.x, enemy.pos.y);
    }
    this.reap(this.enemyGfx, seen, this.enemyLayer);
  }

  private syncProjectiles(): void {
    const projectiles = this.world.getState().projectiles;
    const seen = new Set<string>();
    for (const p of projectiles) {
      seen.add(p.id);
      let g = this.projectileGfx.get(p.id);
      if (!g) {
        g = new Graphics().circle(0, 0, 3).fill(COLORS.projectile);
        this.projectileLayer.addChild(g);
        this.projectileGfx.set(p.id, g);
      }
      g.position.set(p.pos.x, p.pos.y);
    }
    this.reap(this.projectileGfx, seen, this.projectileLayer);
  }

  private drawRange(view: RenderView): void {
    this.range.clear();
    let center: Vec2 | null = null;
    let radius = 0;
    if (view.selectedTowerId) {
      const tower = this.world.getState().towers.find((t) => t.id === view.selectedTowerId);
      const def = tower ? this.registry.getTower(tower.type) : undefined;
      if (tower && def) {
        center = tower.pos;
        radius = effectiveStats(def, tower).range;
      }
    } else if (view.placing) {
      center = view.placing.pos;
      radius = view.placing.range;
    }
    if (center && radius > 0) {
      this.range.circle(center.x, center.y, radius).fill({ color: COLORS.rangeFill, alpha: 0.12 });
      this.range.circle(center.x, center.y, radius).stroke({ width: 1, color: COLORS.rangeFill, alpha: 0.4 });
    }
  }

  private drawGhost(view: RenderView): void {
    this.ghost.clear();
    if (!view.placing) return;
    const { pos, valid } = view.placing;
    const color = valid ? COLORS.placeOk : COLORS.placeBad;
    this.ghost.circle(pos.x, pos.y, TOWER_RADIUS).fill({ color, alpha: 0.5 });
  }

  private reap(map: Map<string, Graphics>, seen: Set<string>, layer: Container): void {
    for (const [id, g] of map) {
      if (!seen.has(id)) {
        layer.removeChild(g);
        g.destroy();
        map.delete(id);
      }
    }
  }
}
