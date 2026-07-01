/**
 * The registry holds every piece of game content (towers, enemies, maps) and
 * every registered {@link Effect}, keyed by id/name.
 *
 * Content is added through *addons*: a plain function `(reg: Registry) => void`.
 * This is what makes the game data-driven and extensible — a new tower, enemy
 * or map is a JSON file plus one `register*` call, and requires **no changes to
 * the core simulation code**.
 */

import type { EnemyDef, MapDef, TowerDef } from './types.js';
import type { Effect } from './effects.js';

/** An addon registers content/effects into a registry. */
export type Addon = (reg: Registry) => void;

export class Registry {
  private readonly towers = new Map<string, TowerDef>();
  private readonly enemies = new Map<string, EnemyDef>();
  private readonly maps = new Map<string, MapDef>();
  private readonly effects = new Map<string, Effect>();

  // --- registration -------------------------------------------------------

  registerTower(def: TowerDef): void {
    this.towers.set(def.id, def);
  }

  registerEnemy(def: EnemyDef): void {
    this.enemies.set(def.id, def);
  }

  registerMap(def: MapDef): void {
    this.maps.set(def.id, def);
  }

  registerEffect(name: string, effect: Effect): void {
    this.effects.set(name, effect);
  }

  /** Apply an addon (chainable). */
  use(addon: Addon): this {
    addon(this);
    return this;
  }

  // --- lookup -------------------------------------------------------------

  getTower(id: string): TowerDef | undefined {
    return this.towers.get(id);
  }

  getEnemy(id: string): EnemyDef | undefined {
    return this.enemies.get(id);
  }

  getMap(id: string): MapDef | undefined {
    return this.maps.get(id);
  }

  getEffect(name: string): Effect | undefined {
    return this.effects.get(name);
  }

  // --- enumeration --------------------------------------------------------

  allTowers(): TowerDef[] {
    return [...this.towers.values()];
  }

  allEnemies(): EnemyDef[] {
    return [...this.enemies.values()];
  }

  allMaps(): MapDef[] {
    return [...this.maps.values()];
  }
}
