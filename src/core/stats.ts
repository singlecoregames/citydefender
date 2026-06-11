import { CANNON, CITY, ECONOMY, EXPLOSION } from './balance';

/**
 * The fully-resolved numbers a single night's sim runs on. Base values come
 * from balance.ts; skill-tree nodes modify them. Keeping this as a flat record
 * lets node effects be declarative ({ stat, op, value }) instead of bespoke
 * code — the same mechanism across the whole tree.
 */
export interface DerivedStats {
  maxAmmo: number;
  reloadSeconds: number;
  interceptorSpeed: number;
  explosionMaxRadius: number;
  explosionDamage: number;
  /** Multiplier on all scrap earned during the night. */
  scrapMul: number;
  /** Multiplier on the night-completion bonus specifically. */
  nightBonusMul: number;
  /** Starting/max HP of each city. */
  cityMaxHp: number;
  /** How close an enemy impact must be to damage a city (smaller = safer). */
  cityHitRadius: number;
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
    nightBonusMul: 1,
    cityMaxHp: CITY.hp,
    cityHitRadius: CITY.hitRadius,
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
