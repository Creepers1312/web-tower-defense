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
- **UpgradePath**: `tiers: [UpgradeTier x4]` (exactly four).
- **UpgradeTier**: `name, cost, modifiers: Partial<{range, fireRate, damage}>`,
  `addEffects?: string[]`.
- **EnemyDef**: `id, name, hp, speed` (units/sec), `reward`, `leakDamage`,
  `flags: string[]` (e.g. `'camo'`).
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

## What NOT to do (this phase)

- No co-op, no server, no WebSocket, no Docker.
- No map editor, no meta-progression / currency, no shop.
- Do **not** fully implement all systems (targeting/combat/economy) —
  **movement only** for now.
- No real graphic assets — coloured circles / rectangles as placeholders.
- Do not pre-build the rest of the roadmap.

## Milestone status

**Milestone 1 (done):** runnable monorepo; all types/contracts defined; one
example map + enemy as JSON; `World` with fixed timestep + `movementSystem`;
`PixiRenderer` shows one enemy following the path; a test proving correct
movement over time (plus `canUpgrade` tests). `pnpm dev` runs the client,
`pnpm test` is green.

## How to run

```bash
pnpm install
pnpm dev     # start the client at http://localhost:5173
pnpm test    # run the core test suite (Vitest)
pnpm typecheck  # type-check every package
```
