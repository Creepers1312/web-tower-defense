import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  registerBuiltinEffects,
  PROJECTILE_SPEED,
  BOOMERANG_MIN_DIAMETER,
  HIT_RADIUS,
  type EnemyDef,
  type MapDef,
  type TowerDef,
  type UpgradePath,
} from '../src/index.js';

// --- fixtures --------------------------------------------------------------

const noopPath: UpgradePath = {
  tiers: [
    { name: 't1', cost: 10, modifiers: {} },
    { name: 't2', cost: 20, modifiers: {} },
    { name: 't3', cost: 30, modifiers: {} },
    { name: 't4', cost: 40, modifiers: {} },
  ],
};

/** A boomerang thrower: shots loop out through the aim point and back. */
const rang: TowerDef = {
  id: 'rang',
  name: 'Rang',
  cost: 100,
  range: 300,
  fireRate: 1,
  damage: 5,
  pierce: 4,
  targeting: 'first',
  flight: 'boomerang',
  effects: ['directDamage'],
  paths: [noopPath, noopPath],
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
  reg.registerTower(rang);
  reg.registerMap(map);
  return new World(reg, 'm', { startMoney: 10000, startLives: 100 });
}

/** Thrower sitting ON the path line at x=100, so the aim runs along +x. */
const TOWER_POS = { x: 100, y: 100 };

/** Place the thrower and park a stationary enemy at `distance` along the path. */
function setup(world: World, enemyDistance: number) {
  world.submit({ kind: 'PlaceTower', type: 'rang', pos: { x: 100, y: 40 } });
  world.step();
  const tower = world.getState().towers[0]!;
  tower.pos = { ...TOWER_POS }; // move onto the path line for axis-aligned aim
  const e = world.spawnEnemy('sitter');
  e.distance = enemyDistance; // movementSystem derives pos from distance
  return { tower, enemy: e };
}

// --- boomerang flight ------------------------------------------------------

describe('boomerang physics', () => {
  it('launches perpendicular to the target line with a full-loop flight budget', () => {
    const world = makeWorld();
    setup(world, 220); // target 120u along +x

    world.step(); // fires this tick
    const p = world.getState().projectiles[0]!;

    // Circle whose diameter is the tower→aim line: r = 60, launched at -90°.
    expect(p.turnRate).toBeCloseTo(PROJECTILE_SPEED / 60, 5);
    expect(p.maxDist).toBeCloseTo(2 * Math.PI * 60, 5);
    // The projectile already flew one tick, so the perpendicular launch
    // heading has turned by exactly turnRate·dt; speed stays constant.
    const heading = Math.atan2(p.vel.y, p.vel.x);
    expect(heading).toBeCloseTo(-Math.PI / 2 + p.turnRate! * World.TIMESTEP, 6);
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(PROJECTILE_SPEED, 6);
  });

  it('sweeps through the aim point and returns to the thrower', () => {
    const world = makeWorld();
    const target = { x: 220, y: 100 };
    const { enemy } = setup(world, 220);
    enemy.hp = 1000; // survives — we only trace the flight here

    world.step();
    const id = world.getState().projectiles[0]!.id;

    let maxFromTower = 0;
    let nearTargetDist = Infinity;
    let last = { ...TOWER_POS };
    for (let i = 0; i < 240; i++) {
      const p = world.getState().projectiles.find((q) => q.id === id);
      if (!p) break;
      last = { ...p.pos };
      maxFromTower = Math.max(maxFromTower, Math.hypot(p.pos.x - TOWER_POS.x, p.pos.y - TOWER_POS.y));
      nearTargetDist = Math.min(nearTargetDist, Math.hypot(p.pos.x - target.x, p.pos.y - target.y));
      world.step();
    }

    // The loop's far side is the aim point (it never overshoots it)...
    expect(maxFromTower).toBeLessThanOrEqual(120 + 2);
    expect(nearTargetDist).toBeLessThanOrEqual(HIT_RADIUS);
    // ...and the flight ends back at the thrower's hand.
    expect(Math.hypot(last.x - TOWER_POS.x, last.y - TOWER_POS.y)).toBeLessThanOrEqual(HIT_RADIUS);
  });

  it('pops an enemy a straight shot on the launch heading would miss', () => {
    const world = makeWorld();
    setup(world, 220);

    const kills: string[] = [];
    world.getEvents().on('onEnemyKilled', (p) => kills.push(p.enemyId));

    // Launched perpendicular to the target, the shot only connects because the
    // loop curves through the aim point.
    for (let i = 0; i < 120; i++) world.step();
    expect(kills).toHaveLength(1);
    expect(world.getState().enemies).toHaveLength(0);
  });

  it('clamps point-blank throws to a minimum loop instead of degenerating', () => {
    const world = makeWorld();
    setup(world, 104); // 4u away from the thrower

    world.step();
    const p = world.getState().projectiles[0]!;
    expect(p.turnRate).toBeCloseTo(PROJECTILE_SPEED / (BOOMERANG_MIN_DIAMETER / 2), 5);
    expect(p.maxDist).toBeCloseTo(Math.PI * BOOMERANG_MIN_DIAMETER, 5);
  });
});
