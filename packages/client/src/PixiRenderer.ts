/**
 * PixiRenderer — reads the read-only simulation state and draws it.
 *
 * This is the whole "darstellung" side of the strict simulation/rendering
 * split: it never mutates the world, it only observes `world.getState()` and
 * pushes the result into PixiJS display objects. All graphics are simple
 * placeholder shapes (coloured circles / lines) — no external assets.
 */

import { Application, Container, Graphics } from 'pixi.js';
import type { World } from '@td/core';

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 600;

const COLORS = {
  background: 0x1e293b,
  path: 0x475569,
  enemy: 0xef4444,
} as const;

const ENEMY_RADIUS = 12;
const PATH_WIDTH = 34;

export class PixiRenderer {
  private readonly app = new Application();
  private readonly enemyLayer = new Container();
  /** One reusable Graphics per live enemy, keyed by enemy id. */
  private readonly enemyGfx = new Map<string, Graphics>();

  constructor(private readonly world: World) {}

  /** Initialise the Pixi application and draw the static map. */
  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      background: COLORS.background,
      antialias: true,
    });
    parent.appendChild(this.app.canvas);

    this.drawPath();
    this.app.stage.addChild(this.enemyLayer);
  }

  /** Draw the map path once as a thick rounded polyline. */
  private drawPath(): void {
    const path = this.world.getMap().path;
    if (path.length < 2) return;

    const g = new Graphics();
    const first = path[0]!;
    g.moveTo(first.x, first.y);
    for (let i = 1; i < path.length; i++) {
      const point = path[i]!;
      g.lineTo(point.x, point.y);
    }
    g.stroke({ width: PATH_WIDTH, color: COLORS.path, cap: 'round', join: 'round' });
    this.app.stage.addChild(g);
  }

  /**
   * Sync display objects with the current state. Called once per animation
   * frame (rendering cadence is independent of the fixed simulation timestep).
   */
  render(): void {
    const state = this.world.getState();
    const seen = new Set<string>();

    for (const enemy of state.enemies) {
      seen.add(enemy.id);
      let g = this.enemyGfx.get(enemy.id);
      if (!g) {
        g = new Graphics().circle(0, 0, ENEMY_RADIUS).fill(COLORS.enemy);
        this.enemyLayer.addChild(g);
        this.enemyGfx.set(enemy.id, g);
      }
      g.position.set(enemy.pos.x, enemy.pos.y);
    }

    // Remove graphics for enemies that no longer exist (killed / leaked).
    for (const [id, g] of this.enemyGfx) {
      if (!seen.has(id)) {
        g.destroy();
        this.enemyGfx.delete(id);
      }
    }
  }
}
