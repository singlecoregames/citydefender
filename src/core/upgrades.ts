import { applyMod, baseStats, type DerivedStats, type StatMod } from './stats';

export type UpgradeBranch = 'cannon' | 'economy' | 'city';

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  branch: UpgradeBranch;
  maxLevel: number;
  baseCost: number;
  /** Cost of level L = round(baseCost * costGrowth^L). */
  costGrowth: number;
  effects: StatMod[];
}

/**
 * M2 starter upgrade set — a small, hand-tuned list to prove the run/economy
 * loop. The M3 skill tree will expand this into the full ~100-node branching
 * tree, reusing this exact declarative shape.
 */
export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'blast_radius',
    name: 'Blast Radius',
    description: '+8% explosion radius',
    branch: 'cannon',
    maxLevel: 8,
    baseCost: 20,
    costGrowth: 1.4,
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.08 }],
  },
  {
    id: 'magazine',
    name: 'Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    maxLevel: 8,
    baseCost: 22,
    costGrowth: 1.4,
    effects: [{ stat: 'maxAmmo', op: 'add', value: 1 }],
  },
  {
    id: 'autoloader',
    name: 'Autoloader',
    description: '-7% reload time',
    branch: 'cannon',
    maxLevel: 6,
    baseCost: 28,
    costGrowth: 1.45,
    effects: [{ stat: 'reloadSeconds', op: 'mul', value: -0.07 }],
  },
  {
    id: 'warhead',
    name: 'Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    maxLevel: 4,
    baseCost: 90,
    costGrowth: 2.0,
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'fast_intercept',
    name: 'Fast Intercept',
    description: '+7% interceptor speed',
    branch: 'cannon',
    maxLevel: 7,
    baseCost: 24,
    costGrowth: 1.4,
    effects: [{ stat: 'interceptorSpeed', op: 'mul', value: 0.07 }],
  },
  {
    id: 'salvage',
    name: 'Salvage',
    description: '+12% scrap earned',
    branch: 'economy',
    maxLevel: 9,
    baseCost: 40,
    costGrowth: 1.45,
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.12 }],
  },
];

export type UpgradeLevels = Record<string, number>;

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** Cost to buy the next level of an upgrade given its current level. Returns
 *  null if already at max level. */
export function nextCost(def: UpgradeDef, currentLevel: number): number | null {
  if (currentLevel >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Resolve base stats + all purchased upgrade levels into final DerivedStats. */
export function resolveStats(levels: UpgradeLevels): DerivedStats {
  const stats = baseStats();
  for (const def of UPGRADES) {
    const lvl = levels[def.id] ?? 0;
    for (const mod of def.effects) applyMod(stats, mod, lvl);
  }
  return stats;
}
