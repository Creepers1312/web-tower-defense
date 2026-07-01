import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  registerBuiltinEffects,
  selectTarget,
  towerCapabilities,
  regrowEnemy,
  createEnemyInstance,
  type EnemyDef,
  type EnemyInstance,
  type MapDef,
  type TowerDef,
  type UpgradePath,
} from '../src/index.js';

// --- fixtures --------------------------------------------------------------

const chain: EnemyDef[] = [
  { id: 'c', name: 'C', hp: 1, speed: 0, reward: 1, leakDamage: 1, flags: [] },
  { id: 'b', name: 'B', hp: 1, speed: 0, reward: 1, leakDamage: 1, flags: [], children: [{ enemyId: 'c', count: 1 }] },
  { id: 'a', name: 'A', hp: 1, speed: 0, reward: 1, leakDamage: 1, flags: [], children: [{ enemyId: 'b', count: 2 }] },
];

const camoA: EnemyDef = { ...chain[2]!, id: 'camoA', flags: ['camo'] };
const leadA: EnemyDef = { id: 'leadA', name: 'Lead', hp: 1, speed: 0, reward: 4, leakDamage: 1, flags: ['lead'] };

function path(): UpgradePath {
  return {
    tiers: [
      { name: '1', cost: 10, modifiers: {} },
      { name: '2', cost: 20, modifiers: {} },
      { name: '3', cost: 30, modifiers: {} },
      { name: '4', cost: 40, modifiers: {} },
    ],
  };
}

const basicGun: TowerDef = {
  id: 'gun',
  name: 'Gun',
  cost: 100,
  range: 300,
  fireRate: 20,
  damage: 100,
  targeting: 'first',
  effects: ['directDamage'],
  paths: [path(), path()],
};
const leadGun: TowerDef = { ...basicGun, id: 'leadGun', popsLead: true };

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

function registry(...towers: TowerDef[]): Registry {
  const reg = new Registry();
  registerBuiltinEffects(reg);
  for (const e of [...chain, camoA, leadA]) reg.registerEnemy(e);
  for (const t of towers.length ? towers : [basicGun]) reg.registerTower(t);
  reg.registerMap(map);
  return reg;
}

const inst = (def: EnemyDef): EnemyInstance =>
  createEnemyInstance(def, 'x', { x: 100, y: 100 });

// --- hierarchy split -------------------------------------------------------

describe('Nallon hierarchy (children on pop)', () => {
  it('pops a parent into its full descendant chain, rewarding every layer', () => {
    const world = new World(registry(), 'm', { startMoney: 200 });
    // Place a one-shot gun on top of the spawn point, then drop an "A".
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 140 } });
    world.step();
    const spent = 200 - world.getState().money; // tower cost

    const killed: string[] = [];
    world.getEvents().on('onEnemyKilled', (p) => killed.push(p.enemyId));

    world.spawnEnemy('a'); // A → 2×B, each B → 1×C
    for (let i = 0; i < 60; i++) world.step();

    // A(1) + B(2) + C(2) = 5 pops, 5 reward.
    expect(killed).toHaveLength(5);
    expect(world.getState().enemies).toHaveLength(0);
    expect(world.getState().money).toBe(200 - spent + 5);
  });

  it('spawns children at the parent position and inherits camo', () => {
    const reg = registry();
    // A slow-firing camo gun: one shot pops the parent, and the next shot is far
    // enough away that the fresh children are still around to inspect.
    const slowCamoGun: TowerDef = { ...basicGun, id: 'scg', camoDetection: true, fireRate: 0.5 };
    reg.registerTower(slowCamoGun);
    const world = new World(reg, 'm');
    world.submit({ kind: 'PlaceTower', type: 'scg', pos: { x: 150, y: 140 } });
    world.step();

    const parent = world.spawnEnemy('camoA');
    parent.distance = 150;
    parent.pos = { x: 150, y: 100 };
    for (let i = 0; i < 30; i++) world.step();

    // After A pops, its two B children exist and are camo (inherited).
    const bs = world.getState().enemies.filter((e) => e.type === 'b');
    expect(bs).toHaveLength(2);
    for (const b of bs) {
      expect(b.flags).toContain('camo');
      expect(b.distance).toBeCloseTo(150, 5); // spawned at the parent's position
    }
  });
});

// --- camo targeting --------------------------------------------------------

describe('camo targeting', () => {
  it('is ignored by towers without camo detection, seen by those with it', () => {
    const camo = inst(camoA);
    expect(selectTarget({ x: 100, y: 100 }, 300, 'first', [camo], false)).toBeNull();
    expect(selectTarget({ x: 100, y: 100 }, 300, 'first', [camo], true)).toBe(camo);
  });
});

// --- lead immunity ---------------------------------------------------------

describe('lead immunity', () => {
  it('is undamaged by a normal tower (leaks) but killed by a lead-popping tower', () => {
    // Normal gun cannot pop lead → it leaks.
    const w1 = new World(registry(basicGun), 'm', { startLives: 10 });
    w1.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 140 } });
    w1.step();
    const lead1 = w1.spawnEnemy('leadA');
    lead1.speed = 60;
    for (let i = 0; i < 450; i++) w1.step();
    expect(w1.getState().lives).toBe(9); // leaked (leakDamage 1)

    // Lead-popping gun kills it → reward, no leak.
    const w2 = new World(registry(leadGun), 'm', { startMoney: 300, startLives: 10 });
    w2.submit({ kind: 'PlaceTower', type: 'leadGun', pos: { x: 40, y: 140 } });
    w2.step();
    const moneyBefore = w2.getState().money;
    const lead2 = w2.spawnEnemy('leadA');
    lead2.speed = 60;
    for (let i = 0; i < 120; i++) w2.step();
    expect(w2.getState().lives).toBe(10);
    expect(w2.getState().money).toBe(moneyBefore + 4); // reward
  });
});

// --- capabilities & regrow -------------------------------------------------

describe('towerCapabilities', () => {
  const withGrants: TowerDef = {
    ...basicGun,
    id: 'g2',
    camoDetection: false,
    popsLead: false,
    paths: [
      {
        tiers: [
          { name: 'a', cost: 1, modifiers: {} },
          { name: 'b', cost: 1, modifiers: {}, grants: { popsLead: true } },
          { name: 'c', cost: 1, modifiers: {} },
          { name: 'd', cost: 1, modifiers: {} },
        ],
      },
      {
        tiers: [
          { name: 'a', cost: 1, modifiers: {}, grants: { camoDetection: true } },
          { name: 'b', cost: 1, modifiers: {} },
          { name: 'c', cost: 1, modifiers: {} },
          { name: 'd', cost: 1, modifiers: {} },
        ],
      },
    ],
  };

  const tower = (a: number, b: number) => ({
    id: 't',
    type: 'g2',
    pos: { x: 0, y: 0 },
    tiers: [a, b] as [number, number],
    targeting: 'first' as const,
    cooldown: 0,
    abilityCooldown: 0,
    abilityActive: 0,
    pops: 0,
  });

  it('reflects base and tier-granted capabilities', () => {
    expect(towerCapabilities(withGrants, tower(0, 0))).toEqual({ camoDetection: false, popsLead: false });
    expect(towerCapabilities(withGrants, tower(2, 0)).popsLead).toBe(true);
    expect(towerCapabilities(withGrants, tower(0, 1)).camoDetection).toBe(true);
  });
});

describe('regrow', () => {
  it('heals a damaged regrow enemy up to maxHp', () => {
    const e = createEnemyInstance(
      { id: 'r', name: 'R', hp: 10, speed: 0, reward: 1, leakDamage: 1, flags: ['regrow'], regrowRate: 5 },
      'r',
      { x: 0, y: 0 },
    );
    e.hp = 2;
    regrowEnemy(e, 1); // +5
    expect(e.hp).toBe(7);
    regrowEnemy(e, 1); // capped at 10
    expect(e.hp).toBe(10);
  });

  it('does nothing for non-regrow enemies', () => {
    const e = createEnemyInstance(
      { id: 'n', name: 'N', hp: 10, speed: 0, reward: 1, leakDamage: 1, flags: [] },
      'n',
      { x: 0, y: 0 },
    );
    e.hp = 2;
    regrowEnemy(e, 1);
    expect(e.hp).toBe(2);
  });
});
