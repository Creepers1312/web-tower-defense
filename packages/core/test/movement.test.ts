import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  progressAlongPath,
  type EnemyDef,
  type MapDef,
} from '../src/index.js';

/** Minimal straight-line map: (0,0) -> (300,0), total length 300. */
const testMap: MapDef = {
  id: 'test_line',
  name: 'Test Line',
  path: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ],
  buildableZones: [],
  waves: [],
};

/** Enemy that moves 60 units per second — one unit per fixed tick. */
const testEnemy: EnemyDef = {
  id: 'test_mover',
  name: 'Mover',
  hp: 10,
  speed: 60,
  reward: 5,
  leakDamage: 1,
  flags: [],
};

function makeWorld(): World {
  const reg = new Registry();
  reg.registerEnemy(testEnemy);
  reg.registerMap(testMap);
  return new World(reg, 'test_line');
}

describe('movementSystem (via World)', () => {
  it('moves an enemy along the path at the expected speed', () => {
    const world = makeWorld();
    world.spawnEnemy('test_mover');

    // 30 ticks == 0.5 s == 30 units along the path.
    for (let i = 0; i < 30; i++) world.step();

    const enemy = world.getState().enemies[0];
    expect(enemy).toBeDefined();
    expect(enemy!.pos.x).toBeCloseTo(30, 5);
    expect(enemy!.pos.y).toBeCloseTo(0, 5);
    expect(enemy!.distance).toBeCloseTo(30, 5);
    expect(enemy!.pathIndex).toBe(0);
  });

  it('advances monotonically further with each tick', () => {
    const world = makeWorld();
    world.spawnEnemy('test_mover');

    let previous = -1;
    for (let i = 0; i < 60; i++) {
      world.step();
      const enemy = world.getState().enemies[0];
      if (!enemy) break; // enemy may have leaked and been removed
      expect(enemy.pos.x).toBeGreaterThan(previous);
      previous = enemy.pos.x;
    }
  });

  it('emits onEnemyLeaked and removes the enemy when it reaches the end', () => {
    const world = makeWorld();
    world.spawnEnemy('test_mover');

    const leaks: { enemyId: string; leakDamage: number }[] = [];
    world.getEvents().on('onEnemyLeaked', (p) => leaks.push(p));

    // 300 units / 60 units-per-sec = 5 s = 300 ticks. Run a bit past that.
    for (let i = 0; i < 320; i++) world.step();

    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.leakDamage).toBe(1);
    expect(world.getState().enemies).toHaveLength(0);
  });
});

describe('progressAlongPath', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('interpolates within the first segment', () => {
    const p = progressAlongPath(path, 40);
    expect(p.pos).toEqual({ x: 40, y: 0 });
    expect(p.segment).toBe(0);
    expect(p.done).toBe(false);
  });

  it('crosses into the second segment', () => {
    const p = progressAlongPath(path, 130);
    expect(p.pos).toEqual({ x: 100, y: 30 });
    expect(p.segment).toBe(1);
    expect(p.done).toBe(false);
  });

  it('clamps to the end and reports done', () => {
    const p = progressAlongPath(path, 999);
    expect(p.pos).toEqual({ x: 100, y: 100 });
    expect(p.done).toBe(true);
  });

  it('clamps to the start for non-positive distance', () => {
    const p = progressAlongPath(path, -5);
    expect(p.pos).toEqual({ x: 0, y: 0 });
    expect(p.done).toBe(false);
  });
});
