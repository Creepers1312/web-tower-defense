/**
 * The World owns the simulation state and drives it forward with a FIXED
 * timestep (1/60 s). It is the single entry point for the "command-in /
 * state-out" contract:
 *
 *   - `submit(cmd)` queues a command (the only way to change the simulation).
 *   - `step()` advances exactly one fixed tick: drain commands, run systems.
 *   - `getState()` returns the read-only state for rendering/inspection.
 *
 * The World knows nothing about rendering, the DOM or the network.
 */

import type { Command } from './commands.js';
import { applyCommand } from './commands.js';
import { EventBus } from './events.js';
import type { Registry } from './registry.js';
import { movementSystem } from './systems/movement.js';
import { createEnemyInstance } from './entities.js';
import type { EnemyInstance, GameState, MapDef } from './types.js';

export interface WorldOptions {
  startMoney?: number;
  startLives?: number;
}

/** Build the initial, empty game state. */
export function createInitialState(options: WorldOptions = {}): GameState {
  return {
    money: options.startMoney ?? 650,
    lives: options.startLives ?? 100,
    waveIndex: 0,
    phase: 'building',
    towers: [],
    enemies: [],
    projectiles: [],
    tick: 0,
  };
}

export class World {
  /** Fixed simulation timestep, in seconds. */
  static readonly TIMESTEP = 1 / 60;

  private readonly state: GameState;
  private readonly registry: Registry;
  private readonly map: MapDef;
  private readonly events = new EventBus();
  private readonly commandQueue: Command[] = [];
  /** Monotonic counter used to mint unique enemy ids. */
  private enemyCounter = 0;

  constructor(registry: Registry, mapId: string, options: WorldOptions = {}) {
    const map = registry.getMap(mapId);
    if (!map) throw new Error(`World: unknown map "${mapId}"`);
    this.registry = registry;
    this.map = map;
    this.state = createInitialState(options);
  }

  // --- accessors ----------------------------------------------------------

  /** Read-only snapshot of the state. Renderers must never mutate this. */
  getState(): Readonly<GameState> {
    return this.state;
  }

  getEvents(): EventBus {
    return this.events;
  }

  getRegistry(): Registry {
    return this.registry;
  }

  getMap(): Readonly<MapDef> {
    return this.map;
  }

  // --- command intake -----------------------------------------------------

  /** Queue a command to be applied at the start of the next `step()`. */
  submit(cmd: Command): void {
    this.commandQueue.push(cmd);
  }

  /**
   * Spawn a single enemy at the start of the path.
   *
   * NOTE (Milestone 1): this is a temporary bootstrap seam so the demo can put
   * one enemy on the field. Once the wave system exists, spawning will be driven
   * by the simulation itself in response to a StartWave command.
   */
  spawnEnemy(enemyId: string): EnemyInstance {
    const def = this.registry.getEnemy(enemyId);
    if (!def) throw new Error(`World: unknown enemy "${enemyId}"`);
    const start = this.map.path[0] ?? { x: 0, y: 0 };
    const enemy = createEnemyInstance(def, `e${this.enemyCounter++}`, start);
    this.state.enemies.push(enemy);
    return enemy;
  }

  // --- simulation ---------------------------------------------------------

  /**
   * Advance the simulation by exactly one fixed timestep.
   *
   * Order: (1) drain queued commands, (2) run systems, (3) advance the clock.
   */
  step(): void {
    // 1. command-in
    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift();
      if (cmd) applyCommand(this.state, this.registry, cmd, this.events);
    }

    // 2. systems (Milestone 1: movement only)
    movementSystem({
      state: this.state,
      map: this.map,
      dt: World.TIMESTEP,
      events: this.events,
    });

    // 3. advance the clock
    this.state.tick += 1;
  }
}
