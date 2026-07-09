import type { DerivedStats } from './stats';

/**
 * Permanent prestige upgrades, bought with prestige points (✦) and kept
 * across run resets. Deliberately visual-first: drones and warhead
 * transformations the player can SEE, plus two economy accelerators.
 */
export interface PrestigeUpgrade {
  id: string;
  maxLevel: number;
  baseCost: number;
  /** Cost of level L = round(baseCost * costGrowth^L). */
  costGrowth: number;
}

export const PRESTIGE_UPGRADES: readonly PrestigeUpgrade[] = [
  /** Permanent +50% ALL damage per level — the wall-breaker. */
  { id: 'arsenal_core', maxLevel: 5, baseCost: 1, costGrowth: 1.6 },
  /** Orbiting combat drones around the cannon: +1 drone per level. */
  { id: 'drone_escort', maxLevel: 3, baseCost: 1, costGrowth: 2.0 },
  /** Interceptor blasts split into 2 extra submunitions per level. */
  { id: 'mirv_warhead', maxLevel: 2, baseCost: 2, costGrowth: 2.4 },
  /** Start each run with banked scrap: +250⬡ per level. */
  { id: 'head_start', maxLevel: 3, baseCost: 1, costGrowth: 1.8 },
  /** Permanent scrap multiplier: +10% per level. */
  { id: 'salvage_core', maxLevel: 3, baseCost: 1, costGrowth: 2.0 },
] as const;
// Total cost of maxing everything ≈ 44✦ ≈ the wall cadence payout plus the
// N200 finish (walls measured at ~N50/100/120, ✦ = bestNight/10).

export type PrestigeLevels = Record<string, number>;

export function prestigeUpgrade(id: string): PrestigeUpgrade | undefined {
  return PRESTIGE_UPGRADES.find((u) => u.id === id);
}

/** Cost of the next level, or null when maxed. */
export function prestigeNextCost(u: PrestigeUpgrade, level: number): number | null {
  if (level >= u.maxLevel) return null;
  return Math.round(u.baseCost * Math.pow(u.costGrowth, level));
}

export const HEAD_START_SCRAP_PER_LEVEL = 250;
export const SALVAGE_CORE_MUL_PER_LEVEL = 0.1;
/** Arsenal Core: permanent multiplier on ALL damage per level. ×2 per level
 *  (×32 maxed) — sized against hpGrowth so each level buys real depth. */
export const ARSENAL_MUL_PER_LEVEL = 1.0;

/** Per-drone combat spec (drones are permanent mini-gatlings on orbit). */
export const DRONE = {
  fireRate: 0.9,
  damage: 1,
  range: 45,
  projectileSpeed: 85,
  /** Orbit centre sits this far above the ground, radius around it. */
  orbitY: 22,
  orbitRadius: 11,
  /** Radians per second the escort ring turns. */
  orbitSpeed: 1.1,
} as const;

/** MIRV: submunitions per level, at this fraction of the main blast radius,
 *  landing this far to each side of the aim point. */
export const MIRV = { splitsPerLevel: 2, radiusFrac: 0.55, offsetFrac: 1.35 } as const;

/** Fold the passive prestige effects into a night's derived stats (mutates).
 *  Drones/MIRV are structural and read from NightConfig instead. */
export function applyPrestigeStats(stats: DerivedStats, levels: PrestigeLevels): DerivedStats {
  stats.scrapMul *= 1 + SALVAGE_CORE_MUL_PER_LEVEL * (levels['salvage_core'] ?? 0);
  const arsenal = Math.pow(1 + ARSENAL_MUL_PER_LEVEL, levels['arsenal_core'] ?? 0);
  stats.turretDamageMul *= arsenal;
  stats.explosionDamage *= arsenal;
  return stats;
}
