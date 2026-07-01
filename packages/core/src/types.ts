/**
 * Data contracts for the tower-defense simulation.
 *
 * These types are the stable "vocabulary" shared by every package. Content
 * (towers/enemies/maps) is authored against the *Def types, while the running
 * simulation stores the *Instance types inside {@link GameState}.
 *
 * IMPORTANT: The runtime {@link GameState} must remain *pure serialisable data*
 * (numbers, strings, booleans, arrays, plain objects). No class instances, no
 * functions, no renderer objects. This keeps a future server-authoritative
 * co-op mode able to serialise the state without any rewrite.
 */

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/** How a tower chooses which enemy to attack. */
export type TargetingMode = 'first' | 'last' | 'close' | 'strong';

// ---------------------------------------------------------------------------
// Definitions (authored content, immutable at runtime)
// ---------------------------------------------------------------------------

/** Numeric bonuses a single upgrade tier applies on top of the base tower. */
export type StatModifiers = Partial<{
  range: number;
  fireRate: number;
  damage: number;
}>;

export interface UpgradeTier {
  name: string;
  cost: number;
  /** Additive bonuses applied to the base stats when this tier is reached. */
  modifiers: StatModifiers;
  /** Effects (by registered name) that this tier adds to the tower. */
  addEffects?: string[];
}

/** A single upgrade branch: exactly four tiers. */
export interface UpgradePath {
  tiers: [UpgradeTier, UpgradeTier, UpgradeTier, UpgradeTier];
}

export interface TowerDef {
  id: string;
  name: string;
  cost: number;
  range: number;
  /** Shots per second. */
  fireRate: number;
  damage: number;
  /** Default targeting mode when the tower is placed. */
  targeting: TargetingMode;
  /** Names of registered effects that fire when the tower attacks. */
  effects: string[];
  /** Exactly two upgrade paths. */
  paths: [UpgradePath, UpgradePath];
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  /** Units per second travelled along the map path. */
  speed: number;
  /** Money granted to the player on kill. */
  reward: number;
  /** Lives lost by the player when this enemy reaches the end of the path. */
  leakDamage: number;
  /** Open-ended tags, e.g. 'camo'. Kept as strings so content stays extensible. */
  flags: string[];
}

export interface WaveEntry {
  enemyId: string;
  count: number;
  /** Seconds between two consecutive spawns of this entry. */
  spacing: number;
  /** Seconds to wait (after the wave starts) before this entry begins spawning. */
  delay: number;
}

export interface Wave {
  entries: WaveEntry[];
}

export interface MapDef {
  id: string;
  name: string;
  /** Ordered waypoints. Enemies walk from path[0] to path[path.length - 1]. */
  path: Vec2[];
  /** Areas in which towers may be placed. */
  buildableZones: Rect[];
  waves: Wave[];
}

// ---------------------------------------------------------------------------
// Instances (mutable runtime state — must stay plain data)
// ---------------------------------------------------------------------------

export interface TowerInstance {
  id: string;
  /** References {@link TowerDef.id}. */
  type: string;
  pos: Vec2;
  /** Current upgrade tier per path. Index 0 -> path A, index 1 -> path B. */
  tiers: [number, number];
  targeting: TargetingMode;
  /** Seconds remaining until this tower can fire again. */
  cooldown: number;
}

export interface EnemyInstance {
  id: string;
  /** References {@link EnemyDef.id}. */
  type: string;
  hp: number;
  maxHp: number;
  pos: Vec2;
  /** Index of the path segment the enemy is currently traversing. */
  pathIndex: number;
  /** Total distance travelled along the path so far (in world units). */
  distance: number;
  /** Units per second (copied from the def so it can be modified at runtime). */
  speed: number;
  /** Lives the player loses if this enemy leaks (copied from the def). */
  leakDamage: number;
  /** Money granted on kill (copied from the def). */
  reward: number;
  flags: string[];
  alive: boolean;
}

export interface ProjectileInstance {
  id: string;
  pos: Vec2;
  /** Target enemy id, or null if the target no longer exists. */
  target: string | null;
  damage: number;
  speed: number;
  /** Id of the tower that fired this projectile (for effect resolution). */
  source: string;
  /** Effect names to run on impact (snapshot of the tower's active effects). */
  effects: string[];
}

export type GamePhase = 'building' | 'wave' | 'won' | 'lost';

export interface GameState {
  money: number;
  lives: number;
  waveIndex: number;
  phase: GamePhase;
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  projectiles: ProjectileInstance[];
  /** Number of fixed simulation steps executed so far. */
  tick: number;
  /** Active map id (so the state is self-describing / serialisable). */
  mapId: string;
  /** Monotonic counter used to mint unique entity ids deterministically. */
  seq: number;
  /** Seconds elapsed in the current wave (only meaningful while phase==='wave'). */
  waveTime: number;
  /** Per-entry spawned counts for the current wave. */
  spawned: number[];
}
