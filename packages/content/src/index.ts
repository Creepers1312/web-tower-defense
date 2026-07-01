/**
 * Content addon: registers all bundled towers, enemies and maps.
 *
 * This is the concrete example of the "addon" pattern — a plain function that
 * receives a {@link Registry} and populates it. Adding new content means adding
 * a JSON file and one `register*` call here; the core engine never changes.
 *
 * The JSON files are validated against the core `*Def` types at import time.
 * We cast through `unknown` because `resolveJsonModule` widens string literals
 * (e.g. `"first"`) to `string`, which is structurally wider than the unions the
 * def types expect.
 */

import type { Addon, EnemyDef, MapDef, TowerDef } from '@td/core';

import runner from '../enemies/runner.json';
import nallons from '../enemies/nallons.json';
import pellet from '../towers/pellet.json';
import boomerang from '../towers/boomerang.json';
import nail from '../towers/nail.json';
import meadow from '../maps/meadow.json';

export const enemies: EnemyDef[] = [
  runner as unknown as EnemyDef,
  ...(nallons as unknown as EnemyDef[]),
];
export const towers: TowerDef[] = [
  pellet as unknown as TowerDef,
  boomerang as unknown as TowerDef,
  nail as unknown as TowerDef,
];
export const maps: MapDef[] = [meadow as unknown as MapDef];

/** Register every bundled definition into the given registry. */
export const contentAddon: Addon = (reg) => {
  for (const enemy of enemies) reg.registerEnemy(enemy);
  for (const tower of towers) reg.registerTower(tower);
  for (const map of maps) reg.registerMap(map);
};

/** Convenience ids so the client doesn't hard-code strings. */
export const DEFAULT_MAP_ID = 'map_meadow';
export const DEFAULT_ENEMY_ID = 'enemy_runner';
