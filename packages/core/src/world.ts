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
import type { SystemContext } from './systems/context.js';
import { spawnSystem } from './systems/spawn.js';
import { movementSystem } from './systems/movement.js';
import { combatSystem } from './systems/combat.js';
import { projectileSystem } from './systems/projectile.js';
import { waveSystem } from './systems/wave.js';
import { createEnemyInstance } from './entities.js';
import type { EnemyInstance, GameState, MapDef } from './types.js';

export interface WorldOptions {
  startMoney?: number;
  startLives?: number;
}

/** Build the initial game state for a given map. */
export function createInitialState(mapId: string, options: WorldOptions = {}): GameState {
  return {
    money: options.startMoney ?? 650,
    lives: options.startLives ?? 100,
    waveIndex: 0,
    phase: 'building',
    towers: [],
    enemies: [],
    projectiles: [],
    tick: 0,
    mapId,
    seq: 0,
    waveTime: 0,
    spawned: [],
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

  constructor(registry: Registry, mapId: string, options: WorldOptions = {}) {
    const map = registry.getMap(mapId);
    if (!map) throw new Error(`World: unknown map "${mapId}"`);
    this.registry = registry;
    this.map = map;
    this.state = createInitialState(map.id, options);
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
   * Wave spawning is normally driven by the simulation (see spawnSystem); this
   * helper remains handy for tests and one-off scripted spawns.
   */
  spawnEnemy(enemyId: string): EnemyInstance {
    const def = this.registry.getEnemy(enemyId);
    if (!def) throw new Error(`World: unknown enemy "${enemyId}"`);
    const start = this.map.path[0] ?? { x: 0, y: 0 };
    const enemy = createEnemyInstance(def, `e${this.state.seq++}`, start);
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

    // 2. systems (order matters: spawn → move → target → resolve → bookkeeping)
    const ctx: SystemContext = {
      world: this,
      state: this.state,
      registry: this.registry,
      map: this.map,
      dt: World.TIMESTEP,
      events: this.events,
    };
    spawnSystem(ctx);
    movementSystem(ctx);
    combatSystem(ctx);
    projectileSystem(ctx);
    waveSystem(ctx);

    // 3. advance the clock
    this.state.tick += 1;
  }
}
