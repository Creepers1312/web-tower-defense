import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  registerBuiltinEffects,
  predictAim,
  progressAlongPath,
  createEnemyInstance,
  PROJECTILE_SPEED,
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
/** A fast crosser: without leading, straight darts trail it and miss. */
const sprinter: EnemyDef = { id: 'sprinter', name: 'Sprinter', hp: 1, speed: 300, reward: 1, leakDamage: 1, flags: [] };

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
  reg.registerEnemy(sprinter);
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

// --- lead / intercept targeting --------------------------------------------

describe('predictAim (lead targeting)', () => {
  const line = map.path;

  it('returns the current position for a stationary enemy (no lead)', () => {
    const e = createEnemyInstance(sitter, 'e', { x: 100, y: 100 });
    e.distance = 100; // pos already (100,100) on the line
    const aim = predictAim({ x: 100, y: 40 }, e, line, PROJECTILE_SPEED);
    expect(aim.x).toBeCloseTo(100, 5);
    expect(aim.y).toBeCloseTo(100, 5);
  });

  it('aims ahead of a moving enemy, at a self-consistent intercept point', () => {
    const e = createEnemyInstance(sprinter, 'e', { x: 100, y: 100 });
    e.distance = 100;
    e.pos = progressAlongPath(line, e.distance).pos;
    const tower = { x: 100, y: 40 };
    const aim = predictAim(tower, e, line, PROJECTILE_SPEED);

    // Leads down-path (ahead of the enemy along +x here).
    expect(aim.x).toBeGreaterThan(e.pos.x);
    expect(aim.y).toBeCloseTo(100, 5);

    // Self-consistency: the enemy actually reaches `aim` exactly when a dart
    // fired now would (flight time = distance / speed).
    const flight = Math.hypot(aim.x - tower.x, aim.y - tower.y) / PROJECTILE_SPEED;
    const enemyAt = progressAlongPath(line, e.distance + e.speed * flight).pos;
    expect(enemyAt.x).toBeCloseTo(aim.x, 1);
    expect(enemyAt.y).toBeCloseTo(aim.y, 1);
  });
});

describe('leading makes towers hit fast movers', () => {
  it('kills a fast enemy crossing past an off-path tower (would miss un-led)', () => {
    const world = makeWorld();
    // Tower set back 60u from the path — the geometry that made un-led darts miss.
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 200, y: 40 } });
    world.step();

    const kills: string[] = [];
    world.getEvents().on('onEnemyKilled', (p) => kills.push(p.enemyId));
    const leaks: string[] = [];
    world.getEvents().on('onEnemyLeaked', (p) => leaks.push(p.enemyId));

    world.spawnEnemy('sprinter'); // enters at path start, sprints across
    for (let i = 0; i < 120; i++) world.step();

    expect(kills).toHaveLength(1);
    expect(leaks).toHaveLength(0);
    expect(world.getState().lives).toBe(100);
  });
});
