# CLAUDE.md — Project guide & guardrails

This file is the durable contract for the project's architecture. Read it before
making changes so the structure stays stable across sessions.

The project is a **web-based tower-defense game** with mechanics/UI inspired by
Bloons TD 5, but using **only original placeholder assets** — no protected
assets, names, or artwork from Ninja Kiwi.

## Tech stack (do not deviate)

- **TypeScript** in `strict` mode.
- **pnpm workspaces** monorepo.
- **Vite** as the client dev server / bundler.
- **PixiJS** as a pure renderer (NOT a game framework like Phaser).
- **Vitest** for tests in the `core` package.
- Node version pinned via `.nvmrc` (no Docker in this phase).

## Monorepo layout

```
packages/
  core/     -> Simulation: types, Registry, systems, effects, upgrade rules, tests.
               Knows nothing about PixiJS, the DOM, or networking.
  content/  -> JSON content (towers/, enemies/, maps/) + an addon that registers it.
  client/   -> Vite + PixiJS. Game loop, renderer, input, UI. Renders only.
```

`server/` and `editor/` are intentionally **not** created yet (future phases).

## Architecture principles (the core — keep these)

1. **Strict separation of simulation and rendering.**
   - `packages/core` holds all game logic. No imports from `client` into `core`.
   - `packages/client` only renders. It reads state **read-only** and never mutates it.
2. **command-in / state-out.**
   - The only way to change the simulation is via **Commands**.
   - `World` holds the state, takes commands through `submit(cmd)`, and ticks the
     logic in `step()` with a **FIXED timestep (1/60 s)** (`World.TIMESTEP`).
   - `getState()` returns a `Readonly` state.
3. **State is pure, serialisable data.**
   - Only numbers, strings, booleans, arrays, plain objects. **No class instances
     with methods, no functions, no PixiJS objects in the state.** (Reason: a later
     server-authoritative co-op mode must serialise state without any rewrite.)
4. **Data-driven & extensible ("addons").**
   - Towers, enemies and maps are defined as JSON in `packages/content`.
   - A `Registry` holds all definitions. An addon is a function
     `(reg: Registry) => void` that registers content.
   - A new tower/enemy/map must require **no change to core code**.
5. **Abilities via composition.**
   - Tower abilities are small, composable **effects** referenced by name in the
     tower data (see the effect contract). Parameters come from the tower data,
     never hard-coded.
6. **Decoupling via an `EventBus`** (`onEnemyKilled`, `onWaveStart`,
   `onEnemyLeaked`, …).

## Data contracts (defined in `packages/core/src/types.ts`)

These fields must exist (extensions are fine, but do not remove/rename these):

- **TowerDef**: `id, name, cost, range, fireRate` (shots/sec), `damage`,
  `targeting: 'first'|'last'|'close'|'strong'`, `effects: string[]`,
  `paths: [UpgradePath, UpgradePath]` (exactly two).
  Optional capabilities: `camoDetection?`, `popsLead?`.
- **UpgradePath**: `tiers: [UpgradeTier x4]` (exactly four).
- **UpgradeTier**: `name, cost, modifiers: Partial<{range, fireRate, damage}>`,
  `addEffects?: string[]`, `grants?: {camoDetection?, popsLead?}`.
- **EnemyDef**: `id, name, hp, speed` (units/sec), `reward`, `leakDamage`,
  `flags: string[]` (e.g. `'camo'`, `'lead'`, `'regrow'`). Optional:
  `children?: {enemyId, count}[]` (spawned when popped), `regrowRate?`, `color?`.
- **MapDef**: `id, name, path: {x,y}[]`, `buildableZones: Rect[]`, `waves: Wave[]`.
- **Wave**: `entries: { enemyId, count, spacing, delay }[]` (seconds).

**Commands** (discriminated union on `kind`): `PlaceTower`, `Upgrade`,
`SellTower`, `SetTargeting`, `StartWave`. Applied by the pure reducer
`applyCommand(state, registry, cmd, events)`.

**GameState** shape: `money, lives, waveIndex, phase, towers, enemies,
projectiles, tick`. `TowerInstance` holds `tiers: [number, number]` (upgrade
level per path).

## Effect contract (the extension seam)

```ts
interface Effect {
  apply(ctx: { world: World; tower: TowerInstance; target: EnemyInstance | null; dt: number }): void;
}
```

Effects are registered by name in the registry and referenced via
`TowerDef.effects` / `UpgradeTier.addEffects`. Parameters come from the tower
data, not hard-coded.

## Upgrade rule (`canUpgrade(tower, path)`)

Two paths, four tiers each, but only **one** path may go beyond tier 2.

- `false` if the path is already at tier 4.
- `false` if the path is at tier `>= 2` **and** the other path is at tier `> 2`.
- `true` otherwise. Symmetric for both paths.

## Testing

Tests live in `packages/core` (Vitest). Covered / to cover:
`canUpgrade`, economy (money/kills/leak), wave spawn (timing/count), and
movement along the path.

## Simulation systems (run in order each tick)

`World.step()` drains commands, then runs the systems in this order:
`spawnSystem` → `movementSystem` → `combatSystem` → `projectileSystem` →
`waveSystem`. All systems take a `SystemContext` and mutate the plain state.

- **spawnSystem** releases the current wave's enemies over time (`delay`/`spacing`),
  tracked by `state.waveTime` + `state.spawned[]`.
- **movementSystem** moves enemies; leaking costs `lives` and can end the game.
- **combatSystem** ticks tower cooldowns, picks a target (`selectTarget`) and
  fires a projectile carrying effective damage + a snapshot of active effects.
- **projectileSystem** flies projectiles to their target and, on impact, runs the
  tower's effects (damage is dealt by the `directDamage` effect); kills grant money.
  A popped enemy spawns its `children` at its position (the Nallon hierarchy).
- **regrowSystem** heals damaged `regrow` enemies back toward `maxHp`.
- **waveSystem** compacts dead enemies and handles wave completion / win.

## Nallon hierarchy & special properties (data-driven)

Enemies ("Nallons") form a hierarchy: popping one spawns its `children`
(e.g. green → blue → red). Special properties are flags on `EnemyDef`, countered
by tower capabilities (`towerCapabilities` folds base + tier `grants`):

- **camo** — only towers with `camoDetection` can target it (`selectTarget`).
- **lead** — only shots with `popsLead` deal damage; others fizzle.
- **regrow** — heals over time (`regrowRate`) until popped.
- Children **inherit** camo/regrow from their parent.

All of this is content: new Nallons/towers are JSON only — no core changes.
Original placeholder theme only (coined term "Nallon"); no Ninja Kiwi names/art.

## Placeholder art (client only)

Original pixel-art placeholders live in `packages/client/public/sprites/` (served
by Vite at `/sprites/*.png`), sliced from the source sheet `art/styles.jpg`.
`EnemyDef.sprite` / `TowerDef.sprite` name a sprite key (data-driven); the
renderer loads it with nearest-neighbour scaling and falls back to a coloured
shape when a sprite is missing. Core never touches sprites — rendering only.

## What NOT to do (this phase)

- No co-op, no server, no WebSocket, no Docker.
- No map editor, no meta-progression / currency, no shop.
- No real graphic assets — coloured circles / rectangles as placeholders.
- Do not pre-build the rest of the roadmap.

## Milestone status

**Milestone 1 (done):** runnable monorepo; all types/contracts defined; one
example map + enemy as JSON; `World` with fixed timestep + `movementSystem`;
`PixiRenderer` shows one enemy following the path; movement + `canUpgrade` tests.

**Milestone 2 (done):** full gameplay loop — wave spawning, tower placement
(with buildable-zone/path/overlap validation), combat (targeting modes +
projectiles + composable effects), and economy (kills→money, leaks→lives,
sell refund, upgrade costs). Client HUD: money/lives/wave, tower palette,
click-to-place, and a selection panel (upgrade both paths, sell, set targeting).
Tests cover spawn timing/count, economy, wave lifecycle, and placement.
`pnpm dev` runs the client, `pnpm test` is green.

**Milestone 3 (done):** the Nallon enemy hierarchy — popping spawns children
(RBE cascade), plus special properties (camo, lead, regrow) as data flags and
matching tower capabilities (`camoDetection`, `popsLead`) unlockable via upgrade
tiers. Renderer shows per-type colours and camo/lead/regrow indicators; HUD shows
tower capabilities. Tests cover hierarchy split + child inheritance, camo
targeting, lead immunity, regrow healing, and capability resolution.

## How to run

```bash
pnpm install
pnpm dev     # start the client at http://localhost:5173
pnpm test    # run the core test suite (Vitest)
pnpm typecheck  # type-check every package
```
