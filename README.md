# Web Tower Defense

A web-based tower-defense game with mechanics and UI inspired by Bloons TD 5,
built with **only original placeholder assets**. This repository currently
contains the architecture, the full data contracts, and **Milestone 1** — a
minimal vertical slice.

> See [`CLAUDE.md`](./CLAUDE.md) for the architecture principles, data contracts,
> and the guardrails that keep the structure stable across sessions.

## Milestone 1

A minimal but complete vertical slice:

- A runnable pnpm-workspaces monorepo.
- All game types / data contracts defined in `@td/core`.
- One example map + one example enemy defined as JSON in `@td/content`.
- A `World` with a fixed 1/60 s timestep and a single `movementSystem` that
  moves enemies along the map path.
- A `PixiRenderer` that reads the read-only state and draws one enemy following
  the path (placeholder coloured shapes only).
- Tests proving the enemy moves correctly along the path over time
  (plus the `canUpgrade` upgrade-rule tests).

**Acceptance:** `pnpm dev` shows exactly one enemy walking the map path in the
browser; `pnpm test` passes.

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
