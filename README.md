# Web Tower Defense

A web-based tower-defense game with mechanics and UI inspired by Bloons TD 5,
built with **only original placeholder assets**. This repository currently
contains the architecture, the full data contracts, and **Milestone 1** — a
minimal vertical slice.

> See [`CLAUDE.md`](./CLAUDE.md) for the architecture principles, data contracts,
> and the guardrails that keep the structure stable across sessions.

## Status

**Milestone 1 (done)** — the foundation vertical slice:

- A runnable pnpm-workspaces monorepo with all data contracts in `@td/core`.
- An example map + enemy as JSON in `@td/content`.
- A `World` with a fixed 1/60 s timestep and the `movementSystem`.
- A `PixiRenderer` that reads read-only state and draws enemies following the path.

**Milestone 2 (done)** — the full core gameplay loop:

- **Wave spawning** — `StartWave` releases a wave's enemies over time
  (`delay`/`spacing`), with automatic wave completion and win/lose transitions.
- **Tower placement** — click to place towers, validated against buildable zones,
  the path, and other towers.
- **Combat** — towers acquire targets (`first`/`last`/`close`/`strong`), fire
  projectiles, and deal damage through composable **effects**.
- **Economy** — kills grant money, leaks cost lives, towers can be upgraded
  (two paths × four tiers) or sold for a refund.
- **Client HUD** — money/lives/wave, a tower palette, click-to-place, and a
  selection panel to upgrade, sell, and set targeting.

Tests cover movement, `canUpgrade`, spawn timing/count, economy, wave lifecycle,
and placement.

**Run it:** `pnpm dev`, place a few towers, press **Start Wave**, and defend.
`pnpm test` is green.

## Tech stack

TypeScript (strict) · pnpm workspaces · Vite · PixiJS (renderer only) · Vitest.
Node version pinned in [`.nvmrc`](./.nvmrc).

## Project layout

```
packages/
  core/     Simulation: types, Registry, systems, effects, upgrade rules, tests.
  content/  JSON content (towers/enemies/maps) + the registration addon.
  client/   Vite + PixiJS. Fixed-timestep loop and renderer.
```

## Getting started

```bash
# 1. Use the pinned Node version (optional but recommended)
nvm use            # reads .nvmrc (Node 22)

# 2. Install dependencies
pnpm install

# 3. Start the client (http://localhost:5173)
pnpm dev

# 4. Run the core tests
pnpm test

# 5. Type-check every package
pnpm typecheck
```
