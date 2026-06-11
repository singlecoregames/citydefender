import { applyMod, baseStats, type DerivedStats, type StatMod } from './stats';

export type TreeBranch = 'core' | 'cannon' | 'economy' | 'city' | 'automation';

/**
 * A single skill-tree node. Effects are declarative stat modifiers applied
 * `level` times. `requires` lists node ids that must have at least one level
 * before this node unlocks — that's what makes the tree branch. Grid `col`/`row`
 * place the node in the layout (the UI converts them to pixels); the tree fans
 * out from the centre: cannon up, economy left, city right.
 */
export interface TreeNode {
  id: string;
  name: string;
  description: string;
  branch: TreeBranch;
  col: number;
  row: number;
  maxLevel: number;
  baseCost: number;
  /** Cost of level L = round(baseCost * costGrowth^L). */
  costGrowth: number;
  requires: string[];
  effects: StatMod[];
}

export type TreeLevels = Record<string, number>;

/**
 * M3 skill tree — three branches off the centre (~24 nodes). The Automation and
 * Tech branches (turrets, abilities) arrive in M4 with the Cores currency; the
 * declarative shape here is what they'll extend.
 */
export const TREE: readonly TreeNode[] = [
  // ── Command core (centre): owned from the start; the trunk every branch
  //    grows from, so the whole tree reads as one connected graph. ─────────
  {
    id: 'core',
    name: 'COMMAND',
    description: 'Your command post. Every branch grows from here.',
    branch: 'core',
    col: 0,
    row: 0,
    maxLevel: 1,
    baseCost: 0,
    costGrowth: 1,
    requires: [],
    effects: [],
  },

  // ── Cannon branch (upwards): manual firepower ──────────────────────────
  {
    id: 'blast_radius',
    name: 'Blast Radius',
    description: '+8% explosion radius',
    branch: 'cannon',
    col: 0,
    row: -1,
    maxLevel: 8,
    baseCost: 20,
    costGrowth: 1.4,
    requires: ['core'],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.08 }],
  },
  {
    id: 'magazine',
    name: 'Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    col: -1,
    row: -2,
    maxLevel: 8,
    baseCost: 22,
    costGrowth: 1.4,
    requires: ['blast_radius'],
    effects: [{ stat: 'maxAmmo', op: 'add', value: 1 }],
  },
  {
    id: 'autoloader',
    name: 'Autoloader',
    description: '-7% reload time',
    branch: 'cannon',
    col: 1,
    row: -2,
    maxLevel: 6,
    baseCost: 28,
    costGrowth: 1.45,
    requires: ['blast_radius'],
    effects: [{ stat: 'reloadSeconds', op: 'mul', value: -0.07 }],
  },
  {
    id: 'fast_intercept',
    name: 'Fast Intercept',
    description: '+7% interceptor speed',
    branch: 'cannon',
    col: 1,
    row: -3,
    maxLevel: 7,
    baseCost: 24,
    costGrowth: 1.4,
    requires: ['autoloader'],
    effects: [{ stat: 'interceptorSpeed', op: 'mul', value: 0.07 }],
  },
  {
    id: 'wide_blast',
    name: 'Wide Blast',
    description: '+12% explosion radius',
    branch: 'cannon',
    col: -1,
    row: -3,
    maxLevel: 5,
    baseCost: 70,
    costGrowth: 1.6,
    requires: ['magazine'],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.12 }],
  },
  {
    id: 'warhead',
    name: 'Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: 0,
    row: -4,
    maxLevel: 4,
    baseCost: 90,
    costGrowth: 2.0,
    requires: ['wide_blast', 'fast_intercept'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'heavy_warhead',
    name: 'Heavy Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: 0,
    row: -5,
    maxLevel: 3,
    baseCost: 260,
    costGrowth: 2.3,
    requires: ['warhead'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },

  // ── Economy branch (left): scrap and bonuses ──────────────────────────
  {
    id: 'salvage',
    name: 'Salvage',
    description: '+12% scrap earned',
    branch: 'economy',
    col: -2,
    row: 0,
    maxLevel: 9,
    baseCost: 40,
    costGrowth: 1.45,
    requires: ['core'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'refinery',
    name: 'Refinery',
    description: '+10% scrap earned',
    branch: 'economy',
    col: -3,
    row: -1,
    maxLevel: 6,
    baseCost: 120,
    costGrowth: 1.6,
    requires: ['salvage'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.1 }],
  },
  {
    id: 'war_bonds',
    name: 'War Bonds',
    description: '+20% night-clear bonus',
    branch: 'economy',
    col: -3,
    row: 1,
    maxLevel: 6,
    baseCost: 60,
    costGrowth: 1.5,
    requires: ['salvage'],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'reserves',
    name: 'Reserves',
    description: '+30% night-clear bonus',
    branch: 'economy',
    col: -4,
    row: 1,
    maxLevel: 4,
    baseCost: 200,
    costGrowth: 1.7,
    requires: ['war_bonds'],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.3 }],
  },

  // ── City branch (right): keep your cities alive ───────────────────────
  {
    id: 'reinforced',
    name: 'Reinforced',
    description: '+1 city HP',
    branch: 'city',
    col: 2,
    row: 0,
    maxLevel: 4,
    baseCost: 80,
    costGrowth: 1.8,
    requires: ['core'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'bunker',
    name: 'Bunker',
    description: '+1 city HP',
    branch: 'city',
    col: 3,
    row: -1,
    maxLevel: 3,
    baseCost: 220,
    costGrowth: 2.0,
    requires: ['reinforced'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'compact',
    name: 'Compact Grid',
    description: '-6% city hit size',
    branch: 'city',
    col: 3,
    row: 1,
    maxLevel: 5,
    baseCost: 70,
    costGrowth: 1.55,
    requires: ['reinforced'],
    effects: [{ stat: 'cityHitRadius', op: 'mul', value: -0.06 }],
  },

  // ── Automation branch (downwards): self-firing turrets ─────────────────
  {
    id: 'auto_turret',
    name: 'Auto-Turret',
    description: '+1 automated turret that fires on its own',
    branch: 'automation',
    col: 0,
    row: 2,
    maxLevel: 5,
    baseCost: 180,
    costGrowth: 1.9,
    requires: ['core'],
    effects: [{ stat: 'turretCount', op: 'add', value: 1 }],
  },
  {
    id: 'turret_power',
    name: 'Turret Power',
    description: '+1 turret damage',
    branch: 'automation',
    col: -1,
    row: 3,
    maxLevel: 5,
    baseCost: 130,
    costGrowth: 1.7,
    requires: ['auto_turret'],
    effects: [{ stat: 'turretDamage', op: 'add', value: 1 }],
  },
  {
    id: 'turret_speed',
    name: 'Overdrive',
    description: '+15% turret fire rate',
    branch: 'automation',
    col: 1,
    row: 3,
    maxLevel: 6,
    baseCost: 110,
    costGrowth: 1.6,
    requires: ['auto_turret'],
    effects: [{ stat: 'turretFireRate', op: 'mul', value: 0.15 }],
  },
  {
    id: 'turret_range',
    name: 'Long Barrel',
    description: '+12% turret range',
    branch: 'automation',
    col: 0,
    row: 4,
    maxLevel: 5,
    baseCost: 90,
    costGrowth: 1.55,
    requires: ['turret_power', 'turret_speed'],
    effects: [{ stat: 'turretRange', op: 'mul', value: 0.12 }],
  },
];

export function getNode(id: string): TreeNode | undefined {
  return TREE.find((n) => n.id === id);
}

/** Cost of the next level, or null if already maxed. */
export function nextCost(node: TreeNode, currentLevel: number): number | null {
  if (currentLevel >= node.maxLevel) return null;
  return Math.round(node.baseCost * Math.pow(node.costGrowth, currentLevel));
}

/** A node is unlocked once every prerequisite has at least one level. */
export function isUnlocked(node: TreeNode, levels: TreeLevels): boolean {
  return node.requires.every((id) => (levels[id] ?? 0) >= 1);
}

/** Resolve base stats + all purchased node levels into final DerivedStats. */
export function resolveStats(levels: TreeLevels): DerivedStats {
  const stats = baseStats();
  for (const node of TREE) {
    const lvl = levels[node.id] ?? 0;
    for (const mod of node.effects) applyMod(stats, mod, lvl);
  }
  return stats;
}
