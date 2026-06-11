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
  /** Global multipliers applied to every deployed turret (which turrets exist
   *  is decided by the tree's turret nodes, not by stats). */
  turretDamageMul: number;
  turretFireRateMul: number;
  turretRangeMul: number;
  /** Per-kind special upgrades (added on top of the kind's base spec). */
  teslaChainBonus: number; // extra chain jumps
  missileSalvoBonus: number; // extra missiles fired per volley
  railgunPierceBonus: number; // extra ray width
  flakRadiusMul: number; // burst radius multiplier
  laserDamageMul: number; // laser-only damage multiplier (tick dps)
  gatlingFireRateMul: number; // gatling-only fire rate multiplier
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
    turretDamageMul: 1,
    turretFireRateMul: 1,
    turretRangeMul: 1,
    teslaChainBonus: 0,
    missileSalvoBonus: 0,
    railgunPierceBonus: 0,
    flakRadiusMul: 1,
    laserDamageMul: 1,
    gatlingFireRateMul: 1,
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
