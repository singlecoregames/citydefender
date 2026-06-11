import { CANNON, ECONOMY, EXPLOSION } from './balance';

/**
 * The fully-resolved numbers a single night's sim runs on. Base values come
 * from balance.ts; upgrades modify them. Keeping this as a flat record lets
 * upgrade effects be declarative ({ stat, op, value }) instead of bespoke code
 * — the same mechanism the M3 skill tree will use.
 */
export interface DerivedStats {
  maxAmmo: number;
  reloadSeconds: number;
  interceptorSpeed: number;
  explosionMaxRadius: number;
  explosionDamage: number;
  /** Multiplier on all scrap earned during the night. */
  scrapMul: number;
}

export type StatKey = keyof DerivedStats;

export type StatOp = 'add' | 'mul';

export interface StatMod {
  stat: StatKey;
  op: StatOp;
  /** For 'mul' this is the per-level factor *increment* (e.g. 0.15 = +15%/lvl). */
  value: number;
}

export function baseStats(): DerivedStats {
  return {
    maxAmmo: CANNON.maxAmmo,
    reloadSeconds: CANNON.reloadSeconds,
    interceptorSpeed: CANNON.interceptorSpeed,
    explosionMaxRadius: EXPLOSION.maxRadius,
    explosionDamage: EXPLOSION.damage,
    scrapMul: 1,
  };
}

/** Apply a stat modifier `levels` times onto a stats object (mutates + returns). */
export function applyMod(stats: DerivedStats, mod: StatMod, levels: number): DerivedStats {
  if (levels <= 0) return stats;
  if (mod.op === 'add') {
    stats[mod.stat] += mod.value * levels;
  } else {
    stats[mod.stat] *= Math.pow(1 + mod.value, levels);
  }
  return stats;
}

export { ECONOMY };
