/**
 * Deterministic wave generator.
 *
 * Produces a fixed set of rounds from a pure formula (no randomness), then bakes
 * them into meadow.json. Because the output is fully deterministic, every game
 * plays the exact same rounds — re-running this script reproduces byte-identical
 * waves. Tweak the curve/roster below and re-run:  node scripts/gen-waves.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(HERE, '..', 'maps', 'meadow.json');

const ROUNDS = 50;

/**
 * Enemy roster with total RBE (its own hits + everything it pops into), the
 * round it first appears, its spawn spacing, and a per-round count cap so no
 * single type floods a round. Must reference ids that exist in nallons.json.
 */
const TYPES = [
  { id: 'nallon_red', rbe: 1, unlock: 1, spacing: 0.45, cap: 60 },
  { id: 'nallon_blue', rbe: 2, unlock: 2, spacing: 0.45, cap: 45 },
  { id: 'nallon_green', rbe: 3, unlock: 3, spacing: 0.5, cap: 34 },
  { id: 'nallon_yellow', rbe: 4, unlock: 4, spacing: 0.4, cap: 28 },
  { id: 'nallon_pink', rbe: 5, unlock: 6, spacing: 0.38, cap: 24 },
  { id: 'nallon_white', rbe: 11, unlock: 8, spacing: 0.7, cap: 14 },
  { id: 'nallon_black', rbe: 11, unlock: 8, spacing: 0.7, cap: 14 },
  { id: 'nallon_camo', rbe: 4, unlock: 12, spacing: 0.6, cap: 12 },
  { id: 'nallon_regrow', rbe: 6, unlock: 13, spacing: 0.6, cap: 10 },
  { id: 'nallon_purple', rbe: 11, unlock: 14, spacing: 0.45, cap: 12 },
  { id: 'nallon_lead', rbe: 23, unlock: 11, spacing: 0.9, cap: 8 },
  { id: 'nallon_zebra', rbe: 23, unlock: 16, spacing: 0.7, cap: 10 },
  { id: 'nallon_rainbow', rbe: 47, unlock: 20, spacing: 0.6, cap: 8 },
  { id: 'nallon_armored', rbe: 104, unlock: 24, spacing: 0.9, cap: 8 }, // ceramic
];

/** Total RBE budget a round should contain — a smooth, ever-rising curve. */
function budget(r) {
  const base = 9 + (r - 1) * 5 + Math.pow(r - 1, 1.7) * 0.8;
  const milestone = r % 10 === 0 ? 1.3 : 1; // every 10th round is a spike
  return Math.round(base * milestone);
}

/** Build one round's entries by greedily filling the budget, strongest-first. */
function buildRound(r) {
  let remaining = budget(r);
  const pool = TYPES.filter((t) => t.unlock <= r);
  const rush = r > 6 && r % 13 === 0; // occasional fast-swarm rounds
  const milestone = r % 10 === 0;

  // Rush rounds: only the fast light types, in big numbers.
  const candidates = rush
    ? pool.filter((t) => ['nallon_yellow', 'nallon_pink', 'nallon_green'].includes(t.id))
    : pool;

  const picks = []; // { type, count }
  // Strongest-first so rounds stay RBE-dense with a few tough enemies + filler.
  const ordered = [...candidates].sort((a, b) => b.rbe - a.rbe);
  for (const type of ordered) {
    if (remaining < type.rbe) continue;
    let cap = type.cap;
    if (milestone && (type.id === 'nallon_armored' || type.id === 'nallon_rainbow')) cap += 4;
    // Don't spend the whole budget on the single strongest type (keep variety),
    // except on rush rounds where flooding is the point.
    const share = rush ? remaining : Math.ceil(remaining * 0.6);
    const count = Math.min(cap, Math.floor(Math.min(remaining, share) / type.rbe));
    if (count > 0) {
      picks.push({ type, count });
      remaining -= count * type.rbe;
    }
  }
  // Top up with reds so the budget is roughly met and round 1 isn't empty.
  if (remaining > 0) {
    const red = TYPES[0];
    const count = Math.min(red.cap, remaining);
    const existing = picks.find((p) => p.type.id === red.id);
    if (existing) existing.count += count;
    else picks.push({ type: red, count });
  }

  // Spawn order: weakest first (they arrive early), tough ones layered in later.
  picks.sort((a, b) => a.type.rbe - b.type.rbe);
  return picks.map((p, i) => ({
    enemyId: p.type.id,
    count: p.count,
    spacing: p.type.spacing,
    delay: Number((i * 1.5).toFixed(2)), // stagger groups a bit
  }));
}

const waves = [];
for (let r = 1; r <= ROUNDS; r++) waves.push({ entries: buildRound(r) });

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
map.waves = waves;
writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');

// Print a short summary for a sanity check.
for (const [i, w] of waves.entries()) {
  const rbe = w.entries.reduce((s, e) => {
    const t = TYPES.find((x) => x.id === e.enemyId);
    return s + e.count * (t ? t.rbe : 0);
  }, 0);
  const desc = w.entries.map((e) => `${e.enemyId.replace('nallon_', '')}x${e.count}`).join(' ');
  console.log(`R${String(i + 1).padStart(2)} rbe~${String(rbe).padStart(4)}  ${desc}`);
}
console.log(`\nWrote ${waves.length} rounds to ${MAP_PATH}`);
