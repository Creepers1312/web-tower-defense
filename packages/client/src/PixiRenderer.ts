/**
 * PixiRenderer — reads the read-only simulation state and draws it.
 *
 * The whole rendering side of the strict simulation/rendering split: it never
 * mutates the world, only observes `world.getState()` and pushes the result into
 * PixiJS display objects.
 *
 * Entities render as pixel-art sprites when a `sprite` key is available in the
 * content data (loaded from `public/sprites/`), and fall back to placeholder
 * shapes otherwise. Sprites use nearest-neighbour scaling to stay crisp.
 */

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
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

const ENEMY_RADIUS = 15; // half of the drawn enemy size
const TOWER_RADIUS = 17;
const PATH_WIDTH = 34;

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

/** A rendered entity: a root container plus a redrawn-each-frame overlay. */
interface EntityNode {
  root: Container;
  overlay: Graphics;
}

export class PixiRenderer {
  private readonly app = new Application();

  // Layers, back-to-front.
  private readonly rangeLayer = new Container();
  private readonly towerLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly ghostLayer = new Container();

  private readonly towerNodes = new Map<string, EntityNode>();
  private readonly enemyNodes = new Map<string, EntityNode>();
  private readonly projectileGfx = new Map<string, Graphics>();
  private readonly textures = new Map<string, Texture>();
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
      antialias: false,
    });
    parent.appendChild(this.app.canvas);

    await this.loadSprites();
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

  /** Load every sprite referenced by content, keyed by its sprite name. */
  private async loadSprites(): Promise<void> {
    const keys = new Set<string>();
    for (const e of this.registry.allEnemies()) if (e.sprite) keys.add(e.sprite);
    for (const t of this.registry.allTowers()) if (t.sprite) keys.add(t.sprite);

    await Promise.all(
      [...keys].map(async (key) => {
        try {
          const tex = await Assets.load<Texture>(`/sprites/${key}.png`);
          tex.source.scaleMode = 'nearest'; // crisp pixel art
          this.textures.set(key, tex);
        } catch {
          /* missing sprite → placeholder shape is used instead */
        }
      }),
    );
  }

  /** Build a sprite body sized to `targetHeight`, or null if no texture. */
  private makeSprite(key: string | undefined, targetHeight: number): Sprite | null {
    if (!key) return null;
    const tex = this.textures.get(key);
    if (!tex) return null;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.scale.set(targetHeight / tex.height);
    return s;
  }

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
    this.syncTowers(view.selectedTowerId);
    this.syncEnemies();
    this.syncProjectiles();
    this.drawRange(view);
    this.drawGhost(view);
  }

  private syncTowers(selectedId: string | null): void {
    const towers = this.world.getState().towers;
    const seen = new Set<string>();
    for (const tower of towers) {
      seen.add(tower.id);
      let node = this.towerNodes.get(tower.id);
      if (!node) {
        const root = new Container();
        const def = this.registry.getTower(tower.type);
        const body =
          this.makeSprite(def?.sprite, TOWER_RADIUS * 2) ??
          new Graphics().circle(0, 0, TOWER_RADIUS).fill(COLORS.tower);
        const overlay = new Graphics();
        root.addChild(body, overlay);
        this.towerLayer.addChild(root);
        node = { root, overlay };
        this.towerNodes.set(tower.id, node);
      }
      node.overlay.clear();
      if (tower.id === selectedId) {
        node.overlay.circle(0, 0, TOWER_RADIUS + 4).stroke({ width: 2, color: COLORS.towerSelected });
      }
      node.root.position.set(tower.pos.x, tower.pos.y);
    }
    this.reapNodes(this.towerNodes, seen, this.towerLayer);
  }

  private syncEnemies(): void {
    const enemies = this.world.getState().enemies;
    const seen = new Set<string>();
    for (const enemy of enemies) {
      seen.add(enemy.id);
      let node = this.enemyNodes.get(enemy.id);
      if (!node) {
        const def = this.registry.getEnemy(enemy.type);
        const isLead = enemy.flags.includes('lead');
        const body =
          this.makeSprite(def?.sprite, ENEMY_RADIUS * 2) ??
          new Graphics()
            .circle(0, 0, ENEMY_RADIUS)
            .fill(isLead ? COLORS.lead : parseColor(def?.color, COLORS.enemy));
        const overlay = new Graphics();
        node = { root: new Container(), overlay };
        node.root.addChild(body, overlay);
        this.enemyLayer.addChild(node.root);
        this.enemyNodes.set(enemy.id, node);
      }

      // Overlay (redrawn each frame): flag rings + HP bar.
      const o = node.overlay;
      o.clear();
      if (enemy.flags.includes('camo')) {
        o.circle(0, 0, ENEMY_RADIUS + 2).stroke({ width: 2, color: COLORS.camoRing });
      }
      if (enemy.flags.includes('regrow')) {
        o.circle(0, 0, ENEMY_RADIUS + 4).stroke({ width: 2, color: COLORS.regrowRing });
      }
      const frac = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0;
      if (frac < 1) {
        const w = 24;
        const y = -ENEMY_RADIUS - 8;
        o.rect(-w / 2, y, w, 4).fill(COLORS.enemyHpBg);
        o.rect(-w / 2, y, w * frac, 4).fill(COLORS.enemyHp);
      }
      node.root.position.set(enemy.pos.x, enemy.pos.y);
    }
    this.reapNodes(this.enemyNodes, seen, this.enemyLayer);
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
    for (const [id, g] of this.projectileGfx) {
      if (!seen.has(id)) {
        this.projectileLayer.removeChild(g);
        g.destroy();
        this.projectileGfx.delete(id);
      }
    }
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

  private reapNodes(map: Map<string, EntityNode>, seen: Set<string>, layer: Container): void {
    for (const [id, node] of map) {
      if (!seen.has(id)) {
        layer.removeChild(node.root);
        node.root.destroy({ children: true });
        map.delete(id);
      }
    }
  }
}
