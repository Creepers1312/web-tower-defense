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

import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
} from 'pixi.js';
import {
  distanceToPath,
  effectiveStats,
  selectTarget,
  towerCapabilities,
  type Registry,
  type Vec2,
  type World,
} from '@td/core';

/** The dart art points its tip ~12.3° above the sprite's local +x axis (it's
 *  drawn diagonally). Subtract this so the tip aligns with the flight heading. */
const DART_SPRITE_FORWARD = -0.215;

export const VIEW_WIDTH = 800;
// The meadow path runs down to y≈660 (its exit), so the view must be at least
// that tall or the bottom of the track gets clipped off-screen.
export const VIEW_HEIGHT = 660;

const COLORS = {
  background: 0x1e293b,
  path: 0x475569,
  enemy: 0xef4444,
  lead: 0x9ca3af,
  camoRing: 0x16a34a,
  regrowRing: 0xf472b6,
  leadRing: 0xcbd5e1,
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

/** Draw a white star burst (the classic "pop" effect). */
function drawStar(g: Graphics, outer: number, points = 9, innerRatio = 0.45): Graphics {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : outer * innerRatio;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.poly(pts).fill(0xffffff);
  return g;
}

/** Draw a placeholder spiky ball (dark body + black triangular spikes). */
function drawSpikyBall(g: Graphics, radius: number, spikes = 8): Graphics {
  const spike = radius * 0.9;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    const perp = a + Math.PI / 2;
    const bx = Math.cos(a) * radius;
    const by = Math.sin(a) * radius;
    const w = radius * 0.4;
    g.poly([
      bx - Math.cos(perp) * w,
      by - Math.sin(perp) * w,
      bx + Math.cos(perp) * w,
      by + Math.sin(perp) * w,
      bx + Math.cos(a) * (radius + spike),
      by + Math.sin(a) * (radius + spike),
    ]).fill(0x111827);
  }
  g.circle(0, 0, radius).fill(0x374151);
  g.circle(0, 0, radius).stroke({ width: 1, color: 0x111827 });
  return g;
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
  /** Sprite key of the current body, so we can swap it when it changes. */
  spriteKey?: string;
  /** The body display object (Sprite / AnimatedSprite / Graphics). */
  body?: Container;
  /** Previous cooldown, to detect the moment a tower fires. */
  prevCooldown?: number;
}

export class PixiRenderer {
  private readonly app = new Application();

  // Layers, back-to-front.
  private readonly mapLayer = new Container();
  private readonly rangeLayer = new Container();
  private readonly towerLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly popLayer = new Container();
  private readonly ghostLayer = new Container();

  /** Pops queued from events this step (big = a boss blimp, small = a balloon). */
  private readonly pendingPops: { x: number; y: number; big: boolean }[] = [];
  /** Active pop effects, aged down each rendered frame. */
  private activePops: { gfx: Container; life: number; maxLife: number; base: number }[] = [];

  private readonly towerNodes = new Map<string, EntityNode>();
  private readonly enemyNodes = new Map<string, EntityNode>();
  private readonly projectileNodes = new Map<string, { obj: Container; kind: string }>();
  /** One or more textures per sprite key (multiple → an animation). */
  private readonly animations = new Map<string, Texture[]>();
  private readonly range = new Graphics();
  private readonly ghost = new Graphics();

  /** The container the canvas lives in, plus a watcher to re-fit on resize. */
  private parent?: HTMLElement;
  private resizeObserver?: ResizeObserver;

  constructor(
    private readonly world: World,
    private readonly registry: Registry,
  ) {
    // Remember where each enemy popped so we can burst a star there.
    this.world.getEvents().on('onEnemyKilled', (p) => {
      const e = this.world.getState().enemies.find((x) => x.id === p.enemyId);
      if (e) this.pendingPops.push({ x: e.pos.x, y: e.pos.y, big: e.maxHp >= 100 });
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      background: COLORS.background,
      antialias: false,
      // Render at the device pixel ratio so upscaling the board stays crisp.
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    parent.appendChild(this.app.canvas);

    await this.loadSprites();
    await this.buildMap();
    this.rangeLayer.addChild(this.range);
    this.ghostLayer.addChild(this.ghost);
    this.app.stage.addChild(
      this.mapLayer,
      this.rangeLayer,
      this.towerLayer,
      this.enemyLayer,
      this.projectileLayer,
      this.popLayer,
      this.ghostLayer,
    );

    // Scale the board to fill its container while keeping the 4:3 world coords
    // (0..VIEW_WIDTH, 0..VIEW_HEIGHT). Re-fit whenever the container resizes.
    this.parent = parent;
    this.fit();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(parent);
  }

  /** Size the renderer to the container and scale the stage so the fixed world
   *  space fills it (letterboxed to preserve aspect). Input mapping is unchanged
   *  because world coords still span 0..VIEW_WIDTH / 0..VIEW_HEIGHT. */
  private fit(): void {
    if (!this.parent) return;
    const cellW = this.parent.clientWidth;
    const cellH = this.parent.clientHeight;
    if (cellW < 1 || cellH < 1) return;
    const scale = Math.min(cellW / VIEW_WIDTH, cellH / VIEW_HEIGHT);
    const w = Math.max(1, Math.round(VIEW_WIDTH * scale));
    const h = Math.max(1, Math.round(VIEW_HEIGHT * scale));
    this.app.renderer.resize(w, h);
    this.app.stage.scale.set(w / VIEW_WIDTH, h / VIEW_HEIGHT);
  }

  /** Build the textured map: tiled grass background + a textured path following
   *  the polyline (a grass-edge rim under a sand-tiled path). Falls back to a
   *  flat colour + grey line if the tiles are missing. */
  private async buildMap(): Promise<void> {
    const path = this.world.getMap().path;
    const grass = await this.loadTile('/sprites/tile_grass.png');
    const sand = await this.loadTile('/sprites/tile_path.png');

    if (grass) {
      this.mapLayer.addChild(new TilingSprite({ texture: grass, width: VIEW_WIDTH, height: VIEW_HEIGHT }));
    } else {
      this.mapLayer.addChild(new Graphics().rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill(0x3f7d3f));
    }

    // Scatter decorations on the grass, kept clear of the path. Deterministic
    // (seeded) so they don't jump around between reloads.
    const decoKeys = ['deco_rock', 'deco_rock2', 'deco_flowers', 'deco_daisy'];
    const decoTex = (await Promise.all(decoKeys.map((k) => this.loadTile(`/sprites/${k}.png`)))).filter(
      (t): t is Texture => !!t,
    );
    if (decoTex.length && path.length >= 2) {
      let seed = 20260701;
      const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < 24; i++) {
        const x = 36 + rnd() * (VIEW_WIDTH - 72);
        const y = 36 + rnd() * (VIEW_HEIGHT - 72);
        const tex = decoTex[Math.floor(rnd() * decoTex.length)]!;
        if (distanceToPath({ x, y }, path) < 42) continue; // keep off the path
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.position.set(x, y);
        this.mapLayer.addChild(s);
      }
    }

    if (path.length < 2) return;
    const stroke = (width: number): Graphics => {
      const g = new Graphics();
      g.moveTo(path[0]!.x, path[0]!.y);
      for (let i = 1; i < path.length; i++) g.lineTo(path[i]!.x, path[i]!.y);
      g.stroke({ width, color: 0xffffff, cap: 'round', join: 'round' });
      return g;
    };

    // Darker grass rim just wider than the path, for definition.
    const rim = stroke(PATH_WIDTH + 8);
    rim.tint = 0x5a7a34;
    this.mapLayer.addChild(rim);

    if (sand) {
      const sandSprite = new TilingSprite({ texture: sand, width: VIEW_WIDTH, height: VIEW_HEIGHT });
      const mask = stroke(PATH_WIDTH);
      this.mapLayer.addChild(sandSprite, mask);
      sandSprite.mask = mask;
    } else {
      this.mapLayer.addChild(stroke(PATH_WIDTH)); // white fallback line
    }
  }

  private async loadTile(url: string): Promise<Texture | null> {
    try {
      return await Assets.load<Texture>(url);
    } catch {
      return null;
    }
  }

  /** Load every sprite referenced by content, keyed by its sprite name.
   *  A key with `{key}_0.png`, `{key}_1.png`, … becomes an animation; otherwise
   *  a single `{key}.png` is loaded. */
  private async loadSprites(): Promise<void> {
    const keys = new Set<string>(['proj_dart', 'pop_big', 'pop_small']); // extra sprites (not in defs)
    for (const e of this.registry.allEnemies()) if (e.sprite) keys.add(e.sprite);
    for (const t of this.registry.allTowers()) {
      if (t.sprite) keys.add(t.sprite);
      for (const path of t.paths) for (const tier of path.tiers) if (tier.sprite) keys.add(tier.sprite);
    }

    const load = async (url: string): Promise<Texture | null> => {
      try {
        const tex = await Assets.load<Texture>(url);
        tex.source.scaleMode = 'nearest'; // crisp pixel art
        return tex;
      } catch {
        return null;
      }
    };

    for (const key of keys) {
      const frames: Texture[] = [];
      for (let i = 0; ; i++) {
        const tex = await load(`/sprites/${key}_${i}.png`);
        if (!tex) break;
        frames.push(tex);
      }
      if (frames.length === 0) {
        const single = await load(`/sprites/${key}.png`);
        if (single) frames.push(single);
      }
      if (frames.length) this.animations.set(key, frames);
    }
  }

  /** Build a body sized to `targetHeight`: an AnimatedSprite for multi-frame
   *  keys (plays once on demand), a Sprite for single frames, or null. */
  private makeBody(key: string | undefined, targetHeight: number): Container | null {
    const frames = key ? this.animations.get(key) : undefined;
    if (!frames || frames.length === 0) return null;
    const first = frames[0]!;
    if (frames.length === 1) {
      const s = new Sprite(first);
      s.anchor.set(0.5);
      s.scale.set(targetHeight / first.height);
      return s;
    }
    const anim = new AnimatedSprite(frames);
    anim.anchor.set(0.5);
    anim.scale.set(targetHeight / first.height);
    anim.animationSpeed = 0.35;
    anim.loop = false;
    anim.onComplete = () => anim.gotoAndStop(0);
    anim.gotoAndStop(0);
    return anim;
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    const scaleX = VIEW_WIDTH / rect.width;
    const scaleY = VIEW_HEIGHT / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  render(view: RenderView): void {
    this.syncTowers(view.selectedTowerId);
    this.syncEnemies();
    this.syncProjectiles();
    this.updatePops();
    this.drawRange(view);
    this.drawGhost(view);
  }

  /** Spawn queued pop stars and age existing ones (grow + fade, then remove). */
  private updatePops(): void {
    for (const p of this.pendingPops) {
      const tex = this.animations.get(p.big ? 'pop_big' : 'pop_small')?.[0];
      let obj: Container;
      let base: number;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        base = (p.big ? 96 : 40) / tex.width; // world-unit target size / texture width
        obj = s;
      } else {
        obj = drawStar(new Graphics(), p.big ? 30 : 13); // fallback if sprite missing
        base = 1;
      }
      obj.position.set(p.x, p.y);
      this.popLayer.addChild(obj);
      this.activePops.push({ gfx: obj, life: 14, maxLife: 14, base });
    }
    this.pendingPops.length = 0;

    const survivors: typeof this.activePops = [];
    for (const pop of this.activePops) {
      pop.life -= 1;
      if (pop.life <= 0) {
        pop.gfx.destroy();
        continue;
      }
      const t = 1 - pop.life / pop.maxLife; // 0 → 1 over its life
      pop.gfx.scale.set(pop.base * (0.6 + t * 1.1));
      pop.gfx.alpha = pop.life / pop.maxLife;
      pop.gfx.rotation = t * 0.6;
      survivors.push(pop);
    }
    this.activePops = survivors;
  }

  /** The sprite key for a tower's current look: the highest reached upgrade
   *  tier that defines a sprite (so the deep path drives the appearance),
   *  falling back to the base tower sprite. */
  private currentTowerSprite(towerId: string): string | undefined {
    const tower = this.world.getState().towers.find((t) => t.id === towerId);
    if (!tower) return undefined;
    const def = this.registry.getTower(tower.type);
    if (!def) return undefined;
    let bestIdx = -1;
    let bestSprite = def.sprite;
    for (let p = 0 as 0 | 1; p <= 1; p = (p + 1) as 0 | 1) {
      const level = tower.tiers[p];
      for (let t = 0; t < level; t++) {
        const s = def.paths[p].tiers[t].sprite;
        if (s && t > bestIdx) {
          bestIdx = t;
          bestSprite = s;
        }
      }
    }
    return bestSprite;
  }

  private syncTowers(selectedId: string | null): void {
    const towers = this.world.getState().towers;
    const seen = new Set<string>();
    for (const tower of towers) {
      seen.add(tower.id);
      const wantKey = this.currentTowerSprite(tower.id);
      let node = this.towerNodes.get(tower.id);
      if (!node) {
        node = { root: new Container(), overlay: new Graphics() };
        this.towerLayer.addChild(node.root);
        this.towerNodes.set(tower.id, node);
      }
      // (Re)build the body when the tower is new or its sprite changed.
      if (node.spriteKey !== wantKey || node.root.children.length === 0) {
        node.root.removeChildren().forEach((c) => c.destroy());
        const body =
          this.makeBody(wantKey, TOWER_RADIUS * 2) ??
          new Graphics().circle(0, 0, TOWER_RADIUS).fill(COLORS.tower);
        node.overlay = new Graphics();
        node.body = body;
        node.root.addChild(body, node.overlay);
        node.spriteKey = wantKey;
        node.prevCooldown = tower.cooldown;
      }

      // Play the fire animation the moment the tower shoots (cooldown resets up).
      if (node.body instanceof AnimatedSprite && tower.cooldown > (node.prevCooldown ?? 0) + 1e-4) {
        node.body.gotoAndPlay(0);
      }
      node.prevCooldown = tower.cooldown;

      // Aim the sprite at the current target (sprites are drawn facing right).
      // Flip vertically when aiming left so the monkey stays upright. Radial
      // towers (tack shooters) fire in all directions, so they stay upright.
      const def = this.registry.getTower(tower.type);
      if (def && def.fireMode !== 'radial' && node.body) {
        const stats = effectiveStats(def, tower);
        const caps = towerCapabilities(def, tower);
        const target = selectTarget(
          tower.pos,
          stats.range,
          tower.targeting,
          this.world.getState().enemies,
          caps.camoDetection,
        );
        if (target) {
          const ang = Math.atan2(target.pos.y - tower.pos.y, target.pos.x - tower.pos.x);
          const s = Math.abs(node.body.scale.x);
          node.body.rotation = ang;
          node.body.scale.y = Math.cos(ang) < 0 ? -s : s;
        }
      }

      node.overlay.clear();
      if (tower.id === selectedId) {
        node.overlay.circle(0, 0, TOWER_RADIUS + 4).stroke({ width: 2, color: COLORS.towerSelected });
      }
      // Pulsing golden ring while an activated ability is buffing this tower.
      if (tower.abilityActive > 0) {
        const pulse = TOWER_RADIUS + 7 + Math.sin(this.world.getState().tick * 0.25) * 2;
        node.overlay.circle(0, 0, pulse).stroke({ width: 2, color: 0xfacc15, alpha: 0.9 });
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
          this.makeBody(def?.sprite, ENEMY_RADIUS * 2) ??
          new Graphics()
            .circle(0, 0, ENEMY_RADIUS)
            .fill(isLead ? COLORS.lead : parseColor(def?.color, COLORS.enemy));
        const overlay = new Graphics();
        node = { root: new Container(), overlay };
        node.root.addChild(body, overlay);
        node.body = body;
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
      if (enemy.flags.includes('lead')) {
        // Steel ring marks a lead Nallon (only lead-popping shots hurt it).
        o.circle(0, 0, ENEMY_RADIUS + 6).stroke({ width: 3, color: COLORS.leadRing });
      }
      const frac = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0;
      if (frac < 1) {
        const w = 24;
        const y = -ENEMY_RADIUS - 8;
        o.rect(-w / 2, y, w, 4).fill(COLORS.enemyHpBg);
        o.rect(-w / 2, y, w * frac, 4).fill(COLORS.enemyHp);
      }
      // Bosses (blimps, maxHp >= 100) scale up with their hit count so they read
      // as bosses; regular Nallons stay at 1x.
      const isBoss = enemy.maxHp >= 100;
      const size = isBoss ? Math.min(4, 1 + Math.log10(enemy.maxHp / 10)) : 1;
      node.root.scale.set(size);
      // Blimps point along the path (their sprite noses up by default); balloons
      // stay upright. Overlay (HP bar/rings) is separate, so it isn't rotated.
      if (isBoss && node.body) {
        const path = this.world.getMap().path;
        const i = Math.min(enemy.pathIndex, path.length - 2);
        const a = path[i]!;
        const b = path[i + 1]!;
        node.body.rotation = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      }
      node.root.position.set(enemy.pos.x, enemy.pos.y);
    }
    this.reapNodes(this.enemyNodes, seen, this.enemyLayer);
  }

  /** Which projectile look a shot uses, based on the firing tower's stage.
   *  Catapult stages throw balls; everything else throws the dart. */
  private projectileKind(sourceTowerId: string): 'dart' | 'a2' | 'a3' | 'a4' {
    const key = this.currentTowerSprite(sourceTowerId);
    if (key === 'dart_a2') return 'a2';
    if (key === 'dart_a3') return 'a3';
    if (key === 'dart_a4') return 'a4';
    return 'dart';
  }

  /** Build the display object for a projectile of the given kind. */
  private makeProjectile(kind: 'dart' | 'a2' | 'a3' | 'a4'): Container {
    if (kind === 'dart') {
      const tex = this.animations.get('proj_dart')?.[0];
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.scale.set(24 / tex.width); // dart ~24px long
        return s;
      }
      return new Graphics().circle(0, 0, 3).fill(COLORS.projectile);
    }
    // Drawn spiky ball (placeholder), bigger for higher tiers.
    const radius = kind === 'a2' ? 5 : kind === 'a3' ? 6 : 7;
    return drawSpikyBall(new Graphics(), radius);
  }

  private syncProjectiles(): void {
    const state = this.world.getState();
    const seen = new Set<string>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let node = this.projectileNodes.get(p.id);
      if (!node) {
        const kind = this.projectileKind(p.source);
        const obj = this.makeProjectile(kind);
        this.projectileLayer.addChild(obj);
        node = { obj, kind };
        this.projectileNodes.set(p.id, node);
      }
      node.obj.position.set(p.pos.x, p.pos.y);
      // Point the dart's tip along its (fixed) direction of travel.
      if (node.kind === 'dart') {
        node.obj.rotation = Math.atan2(p.vel.y, p.vel.x) - DART_SPRITE_FORWARD;
      }
    }
    for (const [id, node] of this.projectileNodes) {
      if (!seen.has(id)) {
        this.projectileLayer.removeChild(node.obj);
        node.obj.destroy();
        this.projectileNodes.delete(id);
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
