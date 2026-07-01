import { describe, it, expect } from 'vitest';
import {
  Registry,
  World,
  registerBuiltinEffects,
  towerAbility,
  abilityBuff,
  createTowerInstance,
  type AbilityDef,
  type MapDef,
  type TowerDef,
  type UpgradePath,
} from '../src/index.js';

// --- fixtures --------------------------------------------------------------

const FAN_CLUB: AbilityDef = {
  id: 'fan_club',
  name: 'Fan Club',
  duration: 5,
  cooldown: 30,
  radius: 100,
  buff: { fireRate: 3, range: 1.5 },
};

/** Path B's last tier carries the activated ability. */
const abilityPath: UpgradePath = {
  tiers: [
    { name: 'b1', cost: 10, modifiers: {} },
    { name: 'b2', cost: 20, modifiers: {} },
    { name: 'b3', cost: 30, modifiers: {} },
    { name: 'b4', cost: 40, modifiers: {}, ability: FAN_CLUB },
  ],
};

const plainPath: UpgradePath = {
  tiers: [
    { name: 'a1', cost: 10, modifiers: {} },
    { name: 'a2', cost: 20, modifiers: {} },
    { name: 'a3', cost: 30, modifiers: {} },
    { name: 'a4', cost: 40, modifiers: {} },
  ],
};

const gun: TowerDef = {
  id: 'gun',
  name: 'Gun',
  cost: 100,
  range: 150,
  fireRate: 1,
  damage: 1,
  targeting: 'first',
  effects: ['directDamage'],
  paths: [plainPath, abilityPath],
};

const map: MapDef = {
  id: 'line',
  name: 'Line',
  path: [
    { x: 0, y: 100 },
    { x: 400, y: 100 },
  ],
  buildableZones: [{ x: 0, y: 0, width: 400, height: 200 }],
  waves: [],
};

function makeRegistry(): Registry {
  const reg = new Registry();
  registerBuiltinEffects(reg);
  reg.registerTower(gun);
  reg.registerMap(map);
  return reg;
}

// --- resolution ------------------------------------------------------------

describe('towerAbility', () => {
  it('returns null until the granting tier is bought', () => {
    const t = createTowerInstance(gun, 't', { x: 0, y: 0 });
    expect(towerAbility(gun, t)).toBeNull();
    t.tiers = [0, 4];
    expect(towerAbility(gun, t)?.id).toBe('fan_club');
  });
});

describe('abilityBuff', () => {
  const get = (id: string) => (id === gun.id ? gun : undefined);

  it('is 1× when no ability is active', () => {
    const state = { towers: [] } as never;
    const t = createTowerInstance(gun, 't', { x: 0, y: 0 });
    expect(abilityBuff(state, get, t)).toEqual({ fireRate: 1, damage: 1, range: 1 });
  });

  it('buffs towers inside the radius and spares those outside it', () => {
    const source = createTowerInstance(gun, 'src', { x: 0, y: 0 });
    source.tiers = [0, 4];
    source.abilityActive = 5;
    const near = createTowerInstance(gun, 'near', { x: 50, y: 0 });
    const far = createTowerInstance(gun, 'far', { x: 300, y: 0 });
    const state = { towers: [source, near, far] } as never;

    expect(abilityBuff(state, get, near)).toEqual({ fireRate: 3, damage: 1, range: 1.5 });
    expect(abilityBuff(state, get, source)).toEqual({ fireRate: 3, damage: 1, range: 1.5 });
    expect(abilityBuff(state, get, far)).toEqual({ fireRate: 1, damage: 1, range: 1 });
  });
});

// --- activation via command ------------------------------------------------

describe('ActivateAbility command', () => {
  function placedTowerWithAbility(world: World): string {
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 40 } });
    world.step();
    const id = world.getState().towers[0]!.id;
    // Buy path B up to the ability tier (needs 4 upgrades on that path).
    for (let i = 0; i < 4; i++) {
      world.submit({ kind: 'Upgrade', towerId: id, path: 1 });
      world.step();
    }
    return id;
  }

  it('starts the buff and the cooldown, then both wind down', () => {
    const world = new World(makeRegistry(), 'line', { startMoney: 10000 });
    const id = placedTowerWithAbility(world);
    expect(world.getState().towers[0]!.tiers[1]).toBe(4);

    world.submit({ kind: 'ActivateAbility', towerId: id });
    world.step();
    const t = world.getState().towers[0]!;
    expect(t.abilityActive).toBeGreaterThan(0);
    expect(t.abilityCooldown).toBeGreaterThan(0);

    // Re-activating while on cooldown does nothing (cooldown keeps counting down).
    const before = world.getState().towers[0]!.abilityCooldown;
    world.submit({ kind: 'ActivateAbility', towerId: id });
    world.step();
    expect(world.getState().towers[0]!.abilityCooldown).toBeLessThan(before);
  });

  it('does nothing for a tower without the ability tier', () => {
    const world = new World(makeRegistry(), 'line', { startMoney: 10000 });
    world.submit({ kind: 'PlaceTower', type: 'gun', pos: { x: 40, y: 40 } });
    world.step();
    const id = world.getState().towers[0]!.id;
    world.submit({ kind: 'ActivateAbility', towerId: id });
    world.step();
    expect(world.getState().towers[0]!.abilityActive).toBe(0);
    expect(world.getState().towers[0]!.abilityCooldown).toBe(0);
  });
});
