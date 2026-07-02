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
  /** Extra enemies a single shot can also hit (0 = hits one). */
  pierce: number;
  /** Extra projectiles fired per shot (base is 1). */
  shots: number;
}>;

/** Special capabilities a tower can have (base or unlocked by an upgrade tier). */
export type TowerCapabilities = Partial<{
  /** Can target camo enemies. */
  camoDetection: boolean;
  /** Can damage lead enemies. */
  popsLead: boolean;
}>;

/**
 * An activated ability unlocked by an upgrade tier. When the player triggers it,
 * every allied tower within `radius` (including the source) gets its stats
 * multiplied by `buff` for `duration` seconds; the ability then recharges over
 * `cooldown` seconds. Purely data — the buff is resolved each tick.
 */
export interface AbilityDef {
  /** Stable id (for the renderer / analytics). */
  id: string;
  /** Human-readable name shown on the activate button. */
  name: string;
  /** Seconds the buff stays active once triggered. */
  duration: number;
  /** Seconds before the ability can be triggered again (measured from trigger). */
  cooldown: number;
  /** World-unit radius of allied towers affected (source tower included). */
  radius: number;
  /** Multipliers applied to affected towers' stats while active. */
  buff: Partial<{ fireRate: number; damage: number; range: number }>;
}

export interface UpgradeTier {
  name: string;
  cost: number;
  /** Additive bonuses applied to the base stats when this tier is reached. */
  modifiers: StatModifiers;
  /** Effects (by registered name) that this tier adds to the tower. */
  addEffects?: string[];
  /** Capabilities this tier unlocks (e.g. camo detection, lead popping). */
  grants?: TowerCapabilities;
  /** Activated ability this tier unlocks (deepest reached tier wins). */
  ability?: AbilityDef;
  /** Sprite key shown once this tier is the tower's highest reached (renderer). */
  sprite?: string;
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
  /** Base extra enemies a single shot pierces (0 = hits one). */
  pierce?: number;
  /** Base projectiles fired per shot (default 1). */
  shots?: number;
  /** How the tower fires: aimed at a target (default) or evenly in all
   *  directions (radial — e.g. a tack shooter). */
  fireMode?: 'targeted' | 'radial';
  /** How fired projectiles fly: in a straight line (default) or along a
   *  circular loop through the aim point and back to the thrower
   *  (boomerang physics). */
  flight?: 'straight' | 'boomerang';
  /** Base special capabilities (may be extended by upgrade tiers). */
  camoDetection?: boolean;
  popsLead?: boolean;
  /** Optional sprite key for the renderer (falls back to a placeholder shape). */
  sprite?: string;
  /** Exactly two upgrade paths. */
  paths: [UpgradePath, UpgradePath];
}

/** A child spawned when a parent enemy is popped (the Nallon hierarchy). */
export interface EnemyChild {
  enemyId: string;
  count: number;
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
  /** Open-ended tags, e.g. 'camo', 'lead', 'regrow'. */
  flags: string[];
  /** Enemies spawned (at the parent's position) when this one is popped. */
  children?: EnemyChild[];
  /** Hp regenerated per second while damaged (used when 'regrow' flag is set). */
  regrowRate?: number;
  /** Placeholder render colour ('#rrggbb'). Interpreted only by the renderer. */
  color?: string;
  /** Optional sprite key for the renderer (falls back to the colour circle). */
  sprite?: string;
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
  /** Seconds until an activated ability can be triggered again (0 = ready). */
  abilityCooldown: number;
  /** Seconds of ability buff remaining (0 = not active). */
  abilityActive: number;
  /** Number of enemies this tower has popped (for the "Pop Count" display). */
  pops: number;
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
  /** Hp regenerated per second while damaged (0 if not a regrow enemy). */
  regrowRate: number;
  flags: string[];
  alive: boolean;
}

export interface ProjectileInstance {
  id: string;
  pos: Vec2;
  /** Velocity in world units/sec. Projectiles do NOT home in on a target: the
   *  flight is fixed at fire time — straight ahead, or (for boomerangs) a
   *  constant-rate turn tracing a circular loop back to the thrower. */
  vel: Vec2;
  /** Radians/sec the heading turns while flying (signed; absent/0 = straight).
   *  A constant turn rate traces a circle of radius `speed / turnRate`. */
  turnRate?: number;
  damage: number;
  /** Id of the tower that fired this projectile (for effect resolution). */
  source: string;
  /** Effect names to run on impact (snapshot of the tower's active effects). */
  effects: string[];
  /** Whether this shot can damage lead enemies (snapshot at fire time). */
  popsLead: boolean;
  /** Enemies this projectile can still pop before it expires (pierce + 1). */
  pops: number;
  /** Ids of enemies already popped, so a shot hits each enemy at most once. */
  hitIds: string[];
  /** Distance travelled so far (world units). */
  traveled: number;
  /** Maximum distance the projectile flies before expiring. */
  maxDist: number;
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
