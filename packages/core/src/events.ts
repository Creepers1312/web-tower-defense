/**
 * A tiny, fully-typed event bus used to decouple systems from side effects.
 *
 * Systems emit domain events ("an enemy leaked", "a wave started"); other
 * parts of the app (UI, sound, analytics, later the network layer) subscribe
 * without the simulation needing to know about them.
 */

/** Map of event name -> payload shape. Extend this as new events are added. */
export interface EventMap {
  onWaveStart: { waveIndex: number };
  onWaveComplete: { waveIndex: number };
  onEnemyKilled: { enemyId: string; reward: number };
  onEnemyLeaked: { enemyId: string; leakDamage: number };
  onTowerPlaced: { towerId: string };
  onTowerSold: { towerId: string; refund: number };
  onTowerUpgraded: { towerId: string; path: 0 | 1; tier: number };
}

export type EventName = keyof EventMap;
export type Listener<K extends EventName> = (payload: EventMap[K]) => void;

/** Internal, type-erased listener. Public methods keep name+fn paired safely. */
type AnyListener = (payload: unknown) => void;

export class EventBus {
  // A set of listeners per event name. Sets make unsubscribe O(1) and dedupe.
  private readonly listeners = new Map<EventName, Set<AnyListener>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends EventName>(name: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set<AnyListener>();
      this.listeners.set(name, set);
    }
    set.add(fn as AnyListener);
    return () => this.off(name, fn);
  }

  off<K extends EventName>(name: K, fn: Listener<K>): void {
    this.listeners.get(name)?.delete(fn as AnyListener);
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    // Iterate over a copy so listeners may unsubscribe during dispatch.
    for (const fn of [...set]) fn(payload);
  }
}
