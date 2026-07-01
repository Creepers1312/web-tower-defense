/**
 * Commands are the ONLY way to mutate the simulation ("command-in / state-out").
 *
 * Each command is a plain, serialisable object (a discriminated union on
 * `kind`), so commands can later be sent over the wire to a server-authoritative
 * host without any transformation. `applyCommand` is a pure reducer over the
 * state: given the current state + registry + command, it mutates the state in
 * place and emits any resulting events.
 */

import type { EventBus } from './events.js';
import type { Registry } from './registry.js';
import type { GameState, TargetingMode, Vec2 } from './types.js';
import { createTowerInstance } from './entities.js';
import { canUpgrade } from './upgrade.js';

// --- command union ---------------------------------------------------------

export interface PlaceTowerCommand {
  kind: 'PlaceTower';
  type: string;
  pos: Vec2;
}

export interface UpgradeCommand {
  kind: 'Upgrade';
  towerId: string;
  path: 0 | 1;
}

export interface SellTowerCommand {
  kind: 'SellTower';
  towerId: string;
}

export interface SetTargetingCommand {
  kind: 'SetTargeting';
  towerId: string;
  mode: TargetingMode;
}

export interface StartWaveCommand {
  kind: 'StartWave';
}

export type Command =
  | PlaceTowerCommand
  | UpgradeCommand
  | SellTowerCommand
  | SetTargetingCommand
  | StartWaveCommand;

/** Fraction of the invested money returned when selling a tower. */
export const SELL_REFUND_RATE = 0.7;

// --- reducer ---------------------------------------------------------------

/**
 * Apply a single command to the state. Invalid commands (unknown tower, not
 * enough money, illegal upgrade, …) are silently ignored so that a malformed
 * or stale command can never crash the simulation.
 */
export function applyCommand(
  state: GameState,
  registry: Registry,
  cmd: Command,
  events: EventBus,
): void {
  switch (cmd.kind) {
    case 'PlaceTower':
      placeTower(state, registry, cmd, events);
      return;
    case 'Upgrade':
      upgradeTower(state, registry, cmd, events);
      return;
    case 'SellTower':
      sellTower(state, registry, cmd, events);
      return;
    case 'SetTargeting':
      setTargeting(state, cmd);
      return;
    case 'StartWave':
      startWave(state, events);
      return;
  }
}

function placeTower(
  state: GameState,
  registry: Registry,
  cmd: PlaceTowerCommand,
  events: EventBus,
): void {
  const def = registry.getTower(cmd.type);
  if (!def) return;
  if (state.money < def.cost) return;

  state.money -= def.cost;
  const id = `t${state.tick}-${state.towers.length}`;
  state.towers.push(createTowerInstance(def, id, cmd.pos));
  events.emit('onTowerPlaced', { towerId: id });
}

function upgradeTower(
  state: GameState,
  registry: Registry,
  cmd: UpgradeCommand,
  events: EventBus,
): void {
  const tower = state.towers.find((t) => t.id === cmd.towerId);
  if (!tower) return;
  const def = registry.getTower(tower.type);
  if (!def) return;
  if (!canUpgrade(tower, cmd.path)) return;

  const nextTier = def.paths[cmd.path].tiers[tower.tiers[cmd.path]];
  if (!nextTier || state.money < nextTier.cost) return;

  state.money -= nextTier.cost;
  tower.tiers[cmd.path] += 1;
  events.emit('onTowerUpgraded', {
    towerId: tower.id,
    path: cmd.path,
    tier: tower.tiers[cmd.path],
  });
}

function sellTower(
  state: GameState,
  registry: Registry,
  cmd: SellTowerCommand,
  events: EventBus,
): void {
  const index = state.towers.findIndex((t) => t.id === cmd.towerId);
  if (index === -1) return;
  const tower = state.towers[index];
  const def = registry.getTower(tower.type);
  if (!def) return;

  // Sum base cost + every purchased tier, then refund a fixed fraction.
  let invested = def.cost;
  for (let path = 0 as 0 | 1; path <= 1; path = (path + 1) as 0 | 1) {
    for (let t = 0; t < tower.tiers[path]; t++) {
      invested += def.paths[path].tiers[t].cost;
    }
  }
  const refund = Math.floor(invested * SELL_REFUND_RATE);

  state.money += refund;
  state.towers.splice(index, 1);
  events.emit('onTowerSold', { towerId: tower.id, refund });
}

function setTargeting(state: GameState, cmd: SetTargetingCommand): void {
  const tower = state.towers.find((t) => t.id === cmd.towerId);
  if (!tower) return;
  tower.targeting = cmd.mode;
}

/**
 * Move from the building phase into the wave phase.
 *
 * NOTE (Milestone 1): actual enemy spawning is not yet wired up — the wave
 * system arrives in a later milestone. This only transitions the phase.
 */
function startWave(state: GameState, events: EventBus): void {
  if (state.phase !== 'building') return;
  state.phase = 'wave';
  events.emit('onWaveStart', { waveIndex: state.waveIndex });
}
