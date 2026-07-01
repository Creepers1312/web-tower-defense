/**
 * Public API of the core simulation package.
 *
 * Everything the client (or a future server) needs is re-exported here so
 * consumers import from `@td/core` rather than reaching into internal files.
 */

// Data contracts
export type {
  Vec2,
  Rect,
  TargetingMode,
  StatModifiers,
  TowerCapabilities,
  AbilityDef,
  UpgradeTier,
  UpgradePath,
  TowerDef,
  EnemyDef,
  EnemyChild,
  WaveEntry,
  Wave,
  MapDef,
  TowerInstance,
  EnemyInstance,
  ProjectileInstance,
  GamePhase,
  GameState,
} from './types.js';

// Registry & addons
export { Registry } from './registry.js';
export type { Addon } from './registry.js';

// Effects (extension seam)
export type { Effect, EffectContext } from './effects.js';
export { directDamage, pierce, multishot } from './effects.js';
export { registerBuiltinEffects } from './builtins.js';

// Events
export { EventBus } from './events.js';
export type { EventMap, EventName, Listener } from './events.js';

// Commands
export { applyCommand, SELL_REFUND_RATE } from './commands.js';
export type {
  Command,
  PlaceTowerCommand,
  UpgradeCommand,
  SellTowerCommand,
  SetTargetingCommand,
  StartWaveCommand,
  ActivateAbilityCommand,
} from './commands.js';

// Upgrade rules
export {
  canUpgrade,
  nextTierCost,
  effectiveStats,
  activeEffects,
  towerCapabilities,
  towerAbility,
  abilityBuff,
} from './upgrade.js';
export type { ResolvedCapabilities, AbilityBuff } from './upgrade.js';

// Entities
export { createEnemyInstance, createTowerInstance } from './entities.js';

// Path helpers
export { progressAlongPath, pathLength } from './path.js';
export type { PathProgress } from './path.js';

// Placement rules
export {
  canPlaceTower,
  pointInRect,
  distanceToPath,
  distanceToSegment,
  PATH_CLEARANCE,
  TOWER_SPACING,
} from './placement.js';

// Systems
export type { SystemContext } from './systems/context.js';
export { spawnSystem } from './systems/spawn.js';
export { abilitySystem } from './systems/ability.js';
export { movementSystem } from './systems/movement.js';
export { combatSystem, selectTarget, PROJECTILE_SPEED } from './systems/combat.js';
export { projectileSystem, HIT_RADIUS } from './systems/projectile.js';
export { regrowSystem, regrowEnemy } from './systems/regrow.js';
export { waveSystem, roundBonus, ROUND_BONUS_BASE, ROUND_BONUS_STEP } from './systems/wave.js';

// World
export { World, createInitialState } from './world.js';
export type { WorldOptions } from './world.js';
