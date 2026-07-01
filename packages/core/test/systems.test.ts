import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  registerBuiltinEffects,
  type EnemyDef,
  type MapDef,
  type TowerDef,
  type UpgradePath,
} from '../src/index.js';

// --- fixtures --------------------------------------------------------------

const dummyPath: UpgradePath = {
  tiers: [
    { name: 't1', cost: 10, modifiers: {} },
    { name: 't2', cost: 20, modifiers: {} },
    { name: 't3', cost: 30, modifiers: {} },
    { name: 't4', cost: 40, modifiers: {} },
  ],
};

const runner: EnemyDef = {
  id: 'runner',
  name: 'Runner',
  hp: 10,
  speed: 60,
  reward: 7,
  leakDamage: 3,
  flags: [],
};

/** An enemy that never moves — handy for isolating spawn/combat behaviour. */
const sitter: EnemyDef = { ...runner, id: 'sitter', speed: 0 };

const gun: TowerDef = {
  id: 'gun',
  name: 'Gun',
  cost: 100,
  range: 150,
  fireRate: 10,
  damage: 100, // one-shots the runner
  targeting: 'first',
  effects: ['directDamage'],
  paths: [dummyPath, dummyPath],
};

function makeRegistry(map: MapDef): Registry {
  const reg = new Registry();
  registerBuiltinEffects(reg);
  reg.registerEnemy(runner);
  reg.registerEnemy(sitter);
  reg.registerTower(gun);
  reg.registerMap(map);
  return reg;
}

const line = (extra: Partial<MapDef> = {}): MapDef => ({
  id: 'line',
  name: 'Line',
  path: [
    { x: 0, y: 100 },
    { x: 400, y: 100 },
  ],
  buildableZones: [{ x: 0, y: 0, width: 400, height: 200 }],
  waves: [{ entries: [{ enemyId: 'runner', count: 2, spacing: 1, delay: 0 }] }],
  ...extra,
});

// --- spawn timing / count --------------------------------------------------

describe('spawnSystem (wave spawning)', () => {
  it('spawns nothing until StartWave', () => {
    const world = new World(makeRegistry(line()), 'line');
    for (let i = 0; i < 120; i++) world.step();
    expect(world.getState().enemies).toHaveLength(0);
    expect(world.getState().phase).toBe('building');
  });

  it('releases enemies on the entry schedule (delay + spacing)', () => {
    // 3 sitters, one per second, no delay. Sitters never move/die, so the
    // enemy count reflects exactly how many have spawned.
    const map = line({ waves: [{ entries: [{ enemyId: 'sitter', count: 3, spacing: 1, delay: 0 }] }] });
    const world = new World(makeRegistry(map), 'line');
    world.submit({ kind: 'StartWave' });

    world.step(); // t≈0 → first spawn
    expect(world.getState().enemies).toHaveLength(1);
    expect(world.getState().phase).toBe('wave');

    for (let i = 0; i < 60; i++) world.step(); // t≈1s → second spawn
    expect(world.getState().enemies).toHaveLength(2);

    for (let i = 0; i < 60; i++) world.step(); // t≈2s → third spawn
    expect(world.getState().enemies).toHaveLength(3);

    for (let i = 0; i < 120; i++) world.step(); // no more than count
    expect(world.getState().enemies).toHaveLength(3);
  });

  it('honours the entry delay before the first spawn', () => {
    const map = line({ waves: [{ entries: [{ enemyId: 'sitter', count: 1, spacing: 1, delay: 2 }] }] });
    const world = new World(makeRegistry(map), 'line');
    world.submit({ kind: 'StartWave' });

    for (let i = 0; i < 60; i++) world.step(); // t≈1s < delay
    expect(world.getState().enemies).toHaveLength(0);

    for (let i = 0; i < 90; i++) world.step(); // t≈2.5s ≥ delay
    expect(world.getState().enemies).toHaveLength(1);
  });
});

// --- economy: kills grant money, leaks cost lives --------------------------

describe('economy', () => {
  it('kills an enemy, grants its reward, and leaves lives intact', () => {
    const map = line({ waves: [{ entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] }] });
    const world = new World(makeRegistry(map), 'line', { startMoney: 650, startLives: 100 });

    // Place a gun near the path start (inside the zone, clear of the path).
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 135 } });
    world.step();
    expect(world.getState().towers).toHaveLength(1);
    expect(world.getState().money).toBe(550); // 650 - 100

    const kills: { enemyId: string; reward: number }[] = [];
    world.getEvents().on('onEnemyKilled', (p) => kills.push(p));

    world.submit({ kind: 'StartWave' });
    for (let i = 0; i < 120; i++) world.step();

    expect(kills).toHaveLength(1);
    expect(kills[0]!.reward).toBe(7);
    // 550 + 7 reward + 100 round-clear bonus (wave index 0).
    expect(world.getState().money).toBe(657);
    expect(world.getState().lives).toBe(100); // nothing leaked
    expect(world.getState().enemies).toHaveLength(0);
  });

  it('loses lives equal to leakDamage when an enemy leaks', () => {
    const map = line({ waves: [{ entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] }] });
    const world = new World(makeRegistry(map), 'line', { startMoney: 300, startLives: 100 });

    const leaks: { enemyId: string; leakDamage: number }[] = [];
    world.getEvents().on('onEnemyLeaked', (p) => leaks.push(p));

    world.submit({ kind: 'StartWave' });
    // 400 units / 60 ups = ~6.7s = ~400 ticks to leak; run past that.
    for (let i = 0; i < 450; i++) world.step();

    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.leakDamage).toBe(3);
    expect(world.getState().lives).toBe(97); // 100 - 3
    // No kill reward, but the round-clear bonus is still awarded: 300 + 100.
    expect(world.getState().money).toBe(400);
  });

  it('awards a growing round-clear bonus on each wave', () => {
    const map = line({
      waves: [
        { entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] },
        { entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] },
      ],
    });
    const world = new World(makeRegistry(map), 'line', { startMoney: 0, startLives: 100 });
    const bonuses: number[] = [];
    world.getEvents().on('onWaveComplete', (p) => bonuses.push(p.bonus));

    world.submit({ kind: 'StartWave' });
    for (let i = 0; i < 450; i++) world.step(); // wave 1 clears (enemy leaks)
    expect(world.getState().phase).toBe('building');
    world.submit({ kind: 'StartWave' });
    for (let i = 0; i < 450; i++) world.step(); // wave 2 clears

    expect(bonuses).toEqual([100, 125]); // base 100, +25 per wave index
    expect(world.getState().money).toBe(225); // 0 + 100 + 125
  });
});

// --- wave lifecycle --------------------------------------------------------

describe('wave lifecycle', () => {
  it('completes the wave once all enemies are gone and wins after the last wave', () => {
    const map = line({ waves: [{ entries: [{ enemyId: 'runner', count: 2, spacing: 0.5, delay: 0 }] }] });
    const world = new World(makeRegistry(map), 'line', { startLives: 100 });

    let completed = 0;
    world.getEvents().on('onWaveComplete', () => completed++);

    world.submit({ kind: 'StartWave' });
    for (let i = 0; i < 600; i++) world.step(); // enough for both to spawn + leak

    expect(completed).toBe(1);
    expect(world.getState().phase).toBe('won');
    expect(world.getState().enemies).toHaveLength(0);
  });

  it('transitions back to building between waves', () => {
    const map = line({
      waves: [
        { entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] },
        { entries: [{ enemyId: 'runner', count: 1, spacing: 1, delay: 0 }] },
      ],
    });
    const world = new World(makeRegistry(map), 'line', { startLives: 100 });

    world.submit({ kind: 'StartWave' });
    for (let i = 0; i < 500; i++) world.step();

    expect(world.getState().phase).toBe('building');
    expect(world.getState().waveIndex).toBe(1);
  });
});
