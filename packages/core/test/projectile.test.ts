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

/** Path A grants pierce; path B grants extra shots (both on tier 1). */
const pathA: UpgradePath = {
  tiers: [
    { name: 'a1', cost: 10, modifiers: { pierce: 3 } },
    { name: 'a2', cost: 20, modifiers: {} },
    { name: 'a3', cost: 30, modifiers: {} },
    { name: 'a4', cost: 40, modifiers: {} },
  ],
};
const pathB: UpgradePath = {
  tiers: [
    { name: 'b1', cost: 10, modifiers: { shots: 2 } },
    { name: 'b2', cost: 20, modifiers: {} },
    { name: 'b3', cost: 30, modifiers: {} },
    { name: 'b4', cost: 40, modifiers: {} },
  ],
};

const gun: TowerDef = {
  id: 'gun',
  name: 'Gun',
  cost: 100,
  range: 300,
  fireRate: 1, // one volley per second → a single volley within a short test
  damage: 5,
  targeting: 'first',
  effects: ['directDamage'],
  paths: [pathA, pathB],
};

const sitter: EnemyDef = { id: 'sitter', name: 'Sitter', hp: 1, speed: 0, reward: 1, leakDamage: 1, flags: [] };

const map: MapDef = {
  id: 'm',
  name: 'M',
  path: [
    { x: 0, y: 100 },
    { x: 400, y: 100 },
  ],
  buildableZones: [{ x: 0, y: 0, width: 400, height: 200 }],
  waves: [],
};

function makeWorld(): World {
  const reg = new Registry();
  registerBuiltinEffects(reg);
  reg.registerEnemy(sitter);
  reg.registerTower(gun);
  reg.registerMap(map);
  return new World(reg, 'm', { startMoney: 10000, startLives: 100 });
}

// --- straight-line flight & multishot fan ----------------------------------

describe('straight-line projectiles', () => {
  it('fires a fan of straight darts (one per shot) that do not home', () => {
    const world = makeWorld();
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 40 } });
    world.step();
    const towerId = world.getState().towers[0]!.id;
    world.submit({ kind: 'Upgrade', towerId, path: 1 }); // +2 shots → 3 total
    world.step();

    // A single enemy in range, far enough that one tick can't reach it.
    const e = world.spawnEnemy('sitter');
    e.pos = { x: 220, y: 40 };
    e.distance = 220;

    world.step(); // tower fires this tick
    const shots = world.getState().projectiles;
    expect(shots).toHaveLength(3);

    // Straight-line model: velocity vectors, no target field.
    for (const p of shots) {
      expect(p.vel).toBeDefined();
      expect(Math.hypot(p.vel.x, p.vel.y)).toBeGreaterThan(0);
      expect((p as unknown as { target?: unknown }).target).toBeUndefined();
    }
    // The fan spreads: three distinct headings.
    const angles = new Set(shots.map((p) => Math.atan2(p.vel.y, p.vel.x).toFixed(3)));
    expect(angles.size).toBe(3);

    // No homing: kill the target, then the dart keeps its exact velocity and
    // advances linearly along it.
    e.alive = false;
    const p0 = world.getState().projectiles[0]!;
    const vx = p0.vel.x;
    const vy = p0.vel.y;
    const before = { ...p0.pos };
    world.step();
    const p1 = world.getState().projectiles.find((p) => p.id === p0.id)!;
    expect(p1.vel.x).toBe(vx);
    expect(p1.vel.y).toBe(vy);
    expect(p1.pos.x).toBeCloseTo(before.x + vx * World.TIMESTEP, 5);
    expect(p1.pos.y).toBeCloseTo(before.y + vy * World.TIMESTEP, 5);
  });

  it('a piercing dart pops several enemies along its flight path', () => {
    const world = makeWorld();
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 40 } });
    world.step();
    const towerId = world.getState().towers[0]!.id;
    world.submit({ kind: 'Upgrade', towerId, path: 0 }); // +3 pierce → pops 4
    world.step();
    // Aim the tower straight down a column of enemies.
    const tower = world.getState().towers[0]!;
    tower.pos = { x: 200, y: 20 };

    const kills: string[] = [];
    world.getEvents().on('onEnemyKilled', (p) => kills.push(p.enemyId));

    // Three collinear enemies directly below the tower.
    const ys = [90, 140, 190];
    ys.forEach((y, i) => {
      const e = world.spawnEnemy('sitter');
      e.pos = { x: 200, y };
      e.distance = 100 + i; // distinct so targeting is deterministic
    });

    for (let i = 0; i < 40; i++) world.step();

    // One volley (fireRate 1) with pierce popped all three in a line.
    expect(kills).toHaveLength(3);
    expect(world.getState().enemies).toHaveLength(0);
  });
});
