import { applyMod, baseStats, type DerivedStats, type StatMod } from './stats';
import type { BuildingKind, TurretKind } from './types';

export type TreeBranch = 'core' | 'cannon' | 'economy' | 'city' | 'automation' | 'tech';

/** A prerequisite: either "node has at least 1 level" (plain id) or a
 *  GRADUATION GATE — "node has at least `level` levels" (Nodebuster-style:
 *  you finish a rung before the next one opens, which keeps the number of
 *  simultaneously open choices small). */
export type NodeRequirement = string | { id: string; level: number };

export function reqId(r: NodeRequirement): string {
  return typeof r === 'string' ? r : r.id;
}

export function reqLevel(r: NodeRequirement): number {
  return typeof r === 'string' ? 1 : r.level;
}

/**
 * A single skill-tree node. Effects are declarative stat modifiers applied
 * `level` times. `requires` lists prerequisites (see NodeRequirement) — that
 * is what makes the tree branch AND what throttles the open frontier. Grid
 * `col`/`row` place the node in the layout (the UI converts them to pixels).
 */
export type Currency = 'scrap' | 'cores';

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
  /** Which currency pays for this node. Defaults to scrap. */
  currency?: Currency;
  /** SPECIAL node: its first level (the unlock) costs this many cores —
   *  the 1-per-boss-kill token — instead of scrap. Later levels follow the
   *  normal scrap curve. The campaign drops 12 cores (bosses N10..120) vs
   *  11 special unlocks, so every boss kill reads as "pick a special". */
  unlockCores?: number;
  /** Upgrade tier, gated by campaign world: tier k unlocks in world k.
   *  Defaults to 1 (available from the start). */
  tier?: 2 | 3 | 4;
  requires: NodeRequirement[];
  effects: StatMod[];
}

/** The currency a node is paid in. */
export function nodeCurrency(node: TreeNode): Currency {
  return node.currency ?? 'scrap';
}

export type TreeLevels = Record<string, number>;

/**
 * Skill tree — THREE long paths off the centre plus a small ops stub, each a
 * trunk with short side-chains (never parallel buffets). Rebuilt on the
 * Nodebuster/Shelldiver pattern after playtests found the old 5-way fan
 * offered 20+ simultaneous choices:
 *
 *   UP    BATTERY    — static field trunk, cannon + Laser side-chains
 *   DOWN  WORKSHOP   — turret ladder trunk, one side-chain per turret kind
 *   RIGHT FOUNDATION — economy trunk, city / support-building side-chains
 *   LEFT  OPS        — the boss-token abilities (never compete for scrap)
 *
 * Three rules keep the shop readable:
 *  1. Graduation gates: most next-ring nodes need the previous node at
 *     level 2-3, not just owned — you finish a rung before more opens.
 *  2. Same-effect repeats sit IN SERIES along a ladder (a deeper, pricier
 *     copy), never side by side.
 *  3. Price bands step hard with graph depth (min of ring d ≥ 1.5 × max of
 *     ring d-1, enforced by a test): d1 20-80, d2 250-300, d3 490-700,
 *     d4 1330-1960, d5 3150-4550, d6 7000-9800, d7 15400-19600.
 *     Tier 2-4 nodes keep their world-stepped prices on top.
 */
export const TREE: readonly TreeNode[] = [
  // ── Command core (centre): owned from the start; the trunk every path
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

  // ═══ UP · BATTERY — the static field (primary attack) up the trunk, the
  //     cannon (burst tool) and the Laser turret on the flanks. ════════════
  {
    id: 'static_charge',
    name: 'Static Charge',
    description: '+0.5 field pulse damage',
    branch: 'cannon',
    col: 0,
    row: -1,
    maxLevel: 5,
    baseCost: 20,
    costGrowth: 1.4,
    requires: ['core'],
    effects: [{ stat: 'fieldDamage', op: 'add', value: 0.5 }],
  },
  {
    id: 'wide_field',
    name: 'Wide Field',
    description: '+10% field radius',
    branch: 'cannon',
    col: 0,
    row: -2,
    maxLevel: 5,
    baseCost: 280,
    costGrowth: 1.5,
    requires: [{ id: 'static_charge', level: 2 }],
    effects: [{ stat: 'fieldRadius', op: 'mul', value: 0.1 }],
  },
  {
    id: 'pulse_cycle',
    name: 'Pulse Cycle',
    description: '-7% pulse cooldown',
    branch: 'cannon',
    col: 0,
    row: -3,
    maxLevel: 5,
    baseCost: 520,
    costGrowth: 1.5,
    requires: [{ id: 'wide_field', level: 2 }],
    effects: [{ stat: 'fieldPulseSeconds', op: 'mul', value: -0.07 }],
  },
  {
    id: 'field_coils',
    name: 'Field Coils',
    description: '+12% field radius, -6% pulse cooldown',
    branch: 'cannon',
    col: 0,
    row: -4,
    maxLevel: 3,
    baseCost: 1550,
    costGrowth: 1.6,
    requires: [{ id: 'pulse_cycle', level: 2 }],
    effects: [
      { stat: 'fieldRadius', op: 'mul', value: 0.12 },
      { stat: 'fieldPulseSeconds', op: 'mul', value: -0.06 },
    ],
  },
  {
    // The field's keystone: the aura rides total turret DPS, so the main
    // attack keeps scaling into the automation era (the Overcharge formula).
    id: 'static_link',
    name: 'Static Link',
    description: 'Field pulses gain +4% of total turret DPS as damage',
    branch: 'cannon',
    col: 0,
    row: -5,
    maxLevel: 5,
    baseCost: 4050,
    costGrowth: 1.7,
    requires: ['field_coils'],
    effects: [{ stat: 'fieldDpsRate', op: 'add', value: 0.04 }],
  },
  // Cannon side-chain (burst tool), west flank.
  {
    id: 'blast_radius',
    name: 'Blast Radius',
    description: '+8% explosion radius',
    branch: 'cannon',
    col: -1,
    row: -1,
    maxLevel: 5,
    baseCost: 250,
    costGrowth: 1.45,
    requires: [{ id: 'static_charge', level: 3 }],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.08 }],
  },
  {
    id: 'drum_magazine',
    name: 'Drum Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    col: -1,
    row: -2,
    maxLevel: 3,
    baseCost: 490,
    costGrowth: 1.6,
    requires: [{ id: 'blast_radius', level: 2 }],
    effects: [{ stat: 'maxAmmo', op: 'add', value: 1 }],
  },
  {
    id: 'autoloader',
    name: 'Autoloader',
    description: '-7% reload time',
    branch: 'cannon',
    col: -2,
    row: -2,
    maxLevel: 5,
    baseCost: 1330,
    costGrowth: 1.5,
    requires: ['drum_magazine'],
    effects: [{ stat: 'reloadSeconds', op: 'mul', value: -0.07 }],
  },
  {
    id: 'wide_blast',
    name: 'Wide Blast',
    description: '+14% explosion radius',
    branch: 'cannon',
    col: -1,
    row: -3,
    maxLevel: 5,
    baseCost: 1440,
    costGrowth: 1.55,
    requires: [{ id: 'drum_magazine', level: 2 }],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.14 }],
  },
  {
    id: 'fast_intercept',
    name: 'Fast Intercept',
    description: '+10% interceptor speed',
    branch: 'cannon',
    col: -2,
    row: -3,
    maxLevel: 5,
    baseCost: 3150,
    costGrowth: 1.5,
    requires: [{ id: 'autoloader', level: 2 }],
    effects: [{ stat: 'interceptorSpeed', op: 'mul', value: 0.1 }],
  },
  {
    id: 'warhead',
    name: 'Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: -1,
    row: -4,
    maxLevel: 3,
    baseCost: 3500,
    costGrowth: 2.0,
    requires: [{ id: 'wide_blast', level: 2 }],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'combo_memory',
    name: 'Combo Memory',
    description: 'Keep 25% of your combo when it breaks',
    branch: 'cannon',
    col: -2,
    row: -4,
    maxLevel: 3,
    baseCost: 7000,
    costGrowth: 1.7,
    requires: ['warhead'],
    effects: [{ stat: 'comboRetention', op: 'add', value: 0.25 }],
  },
  {
    id: 'overcharge_shot',
    name: 'Overcharge Shot',
    description: 'Manual blasts gain +4% of total turret DPS as damage',
    branch: 'cannon',
    col: -1,
    row: -5,
    maxLevel: 5,
    baseCost: 8750,
    costGrowth: 1.7,
    requires: [{ id: 'warhead', level: 2 }],
    effects: [{ stat: 'overchargeRate', op: 'add', value: 0.04 }],
  },
  {
    id: 'heavy_warhead',
    name: 'Heavy Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: -2,
    row: -5,
    maxLevel: 3,
    baseCost: 15400,
    costGrowth: 2.2,
    requires: ['overcharge_shot'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'mirv_warhead',
    name: 'MIRV Warhead',
    description: 'Interceptor blasts split into +2 submunitions per level',
    branch: 'cannon',
    col: -3,
    row: -4,
    maxLevel: 2,
    baseCost: 700000,
    costGrowth: 2.0,
    unlockCores: 1,
    tier: 2,
    requires: ['warhead'],
    effects: [{ stat: 'mirvLevel', op: 'add', value: 1 }],
  },
  // Laser side-chain, east flank.
  {
    id: 'turret_laser',
    name: 'Laser',
    description: 'Deploy a Laser turret: short range, never misses (lvl = +dmg)',
    branch: 'automation',
    col: 1,
    row: -2,
    maxLevel: 5,
    baseCost: 560,
    costGrowth: 1.9,
    requires: ['wide_field'],
    effects: [],
  },
  {
    id: 'laser_focus',
    name: 'Focusing Lens',
    description: '+25% Laser damage',
    branch: 'automation',
    col: 1,
    row: -3,
    maxLevel: 5,
    baseCost: 1400,
    costGrowth: 1.8,
    requires: ['turret_laser'],
    effects: [{ stat: 'laserDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'laser_reach',
    name: 'Beam Extender',
    description: '+15% Laser range',
    branch: 'automation',
    col: 1,
    row: -4,
    maxLevel: 3,
    baseCost: 3850,
    costGrowth: 1.8,
    requires: [{ id: 'laser_focus', level: 2 }],
    effects: [{ stat: 'laserRangeMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'laser_twin',
    name: 'Twin Laser',
    description: 'Deploy a second Laser on the right flank',
    branch: 'automation',
    col: 1,
    row: -5,
    maxLevel: 1,
    baseCost: 6300000,
    costGrowth: 1,
    tier: 3,
    requires: ['laser_reach'],
    effects: [],
  },

  // ═══ DOWN · WORKSHOP — the turret ladder up the trunk, one short
  //     side-chain per turret kind, fire-control tech on the west. ═════════
  {
    id: 'turret_gatling',
    name: 'Gatling',
    description: 'Deploy a Gatling turret: fast single-target fire (lvl = +30% dmg)',
    branch: 'automation',
    col: 0,
    row: 1,
    maxLevel: 5,
    baseCost: 80,
    costGrowth: 1.9,
    requires: ['core'],
    effects: [],
  },
  {
    id: 'turret_power',
    name: 'Turret Power',
    description: '+15% all turret damage',
    branch: 'automation',
    col: 0,
    row: 2,
    maxLevel: 5,
    baseCost: 300,
    costGrowth: 1.75,
    requires: [{ id: 'turret_gatling', level: 2 }],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'turret_speed',
    name: 'Overdrive',
    description: '+12% all turret fire rate',
    branch: 'automation',
    col: 0,
    row: 3,
    maxLevel: 5,
    baseCost: 500,
    costGrowth: 1.75,
    requires: [{ id: 'turret_power', level: 3 }],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'overcharge_matrix',
    name: 'Overcharge Matrix',
    description: '+40% all turret damage',
    branch: 'automation',
    col: 0,
    row: 4,
    maxLevel: 5,
    baseCost: 1500,
    costGrowth: 1.75,
    requires: [{ id: 'turret_speed', level: 3 }],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.4 }],
  },
  {
    id: 'turret_power2',
    name: 'Turret Power II',
    description: '+15% all turret damage',
    branch: 'automation',
    col: 0,
    row: 5,
    maxLevel: 5,
    baseCost: 4550,
    costGrowth: 1.75,
    requires: [{ id: 'overcharge_matrix', level: 2 }],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'turret_speed2',
    name: 'Overdrive II',
    description: '+12% all turret fire rate',
    branch: 'automation',
    col: 0,
    row: 6,
    maxLevel: 5,
    baseCost: 9800,
    costGrowth: 1.75,
    requires: [{ id: 'turret_power2', level: 2 }],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'arsenal_core',
    name: 'Arsenal Core',
    description: '+50% ALL damage (turrets and blasts)',
    branch: 'automation',
    col: 0,
    row: 7,
    maxLevel: 5,
    baseCost: 200000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 2,
    requires: ['turret_speed2'],
    effects: [
      { stat: 'turretDamageMul', op: 'mul', value: 0.5 },
      { stat: 'explosionDamage', op: 'mul', value: 0.5 },
    ],
  },
  // Gatling side-chain, west.
  {
    id: 'gatling_spin',
    name: 'Spin-Up',
    description: '+18% Gatling fire rate',
    branch: 'automation',
    col: -1,
    row: 1,
    maxLevel: 5,
    baseCost: 260,
    costGrowth: 1.8,
    requires: [{ id: 'turret_gatling', level: 3 }],
    effects: [{ stat: 'gatlingFireRateMul', op: 'mul', value: 0.18 }],
  },
  {
    id: 'gatling_belt',
    name: 'Tungsten Belt',
    description: '+25% Gatling damage',
    branch: 'automation',
    col: -1,
    row: 2,
    maxLevel: 5,
    baseCost: 490,
    costGrowth: 1.8,
    requires: [{ id: 'gatling_spin', level: 3 }],
    effects: [{ stat: 'gatlingDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'gatling_twin',
    name: 'Twin Gatling',
    description: 'Deploy a second Gatling on the right flank',
    branch: 'automation',
    col: -1,
    row: 3,
    maxLevel: 1,
    baseCost: 4500000,
    costGrowth: 1,
    tier: 3,
    requires: [{ id: 'gatling_belt', level: 3 }],
    effects: [],
  },
  {
    id: 'auto_fire',
    name: 'Auto-Fire',
    description: 'Cannon fires by itself when idle with a full magazine (lvl = arms faster)',
    branch: 'automation',
    col: -2,
    row: 1,
    maxLevel: 3,
    baseCost: 490,
    costGrowth: 1.6,
    requires: ['gatling_spin'],
    effects: [{ stat: 'autoFireLevel', op: 'add', value: 1 }],
  },
  {
    id: 'drone_escort',
    name: 'Drone Escort',
    description: 'Deploy an orbiting combat drone (+1 per level)',
    branch: 'automation',
    col: -2,
    row: 2,
    maxLevel: 3,
    baseCost: 350000,
    costGrowth: 1.9,
    unlockCores: 1,
    tier: 2,
    requires: ['auto_fire'],
    effects: [{ stat: 'droneCount', op: 'add', value: 1 }],
  },
  // Missile side-chain, far west.
  {
    id: 'turret_missile',
    name: 'Missile Pod',
    description: 'Deploy a Missile Pod: slow homing shots that never lose their prey (lvl = +dmg)',
    branch: 'automation',
    col: -2,
    row: 3,
    maxLevel: 5,
    baseCost: 1960,
    costGrowth: 1.9,
    requires: ['gatling_belt'],
    effects: [],
  },
  {
    id: 'missile_salvo',
    name: 'Salvo Rack',
    description: '+1 missile per volley',
    branch: 'automation',
    col: -2,
    row: 4,
    maxLevel: 3,
    baseCost: 3500,
    costGrowth: 2.0,
    requires: [{ id: 'turret_missile', level: 2 }],
    effects: [{ stat: 'missileSalvoBonus', op: 'add', value: 1 }],
  },
  {
    id: 'missile_warheads',
    name: 'Shaped Charges',
    description: '+30% Missile damage',
    branch: 'automation',
    col: -2,
    row: 5,
    maxLevel: 3,
    baseCost: 9100,
    costGrowth: 1.9,
    requires: ['missile_salvo'],
    effects: [{ stat: 'missileDamageMul', op: 'mul', value: 0.3 }],
  },
  {
    id: 'missile_twin',
    name: 'Twin Missile Pod',
    description: 'Deploy a second Missile Pod on the left flank',
    branch: 'automation',
    col: -2,
    row: 6,
    maxLevel: 1,
    baseCost: 7200000,
    costGrowth: 1,
    tier: 3,
    requires: ['missile_warheads'],
    effects: [],
  },
  // Fire-control tech, west of the deep trunk.
  {
    id: 'bld_radar',
    name: 'Radar Array',
    description: 'Deploy: tightens every turret’s aim (-15% spread per lvl)',
    branch: 'tech',
    col: -1,
    row: 4,
    maxLevel: 3,
    baseCost: 1330,
    costGrowth: 1.9,
    requires: ['turret_speed'],
    effects: [],
  },
  {
    id: 'doppler_tracking',
    name: 'Doppler Tracking',
    description: 'Radar lets turrets hit phased enemies',
    branch: 'tech',
    col: -3,
    row: 4,
    maxLevel: 1,
    baseCost: 3500,
    costGrowth: 1,
    requires: [{ id: 'bld_radar', level: 2 }],
    effects: [{ stat: 'dopplerTracking', op: 'add', value: 1 }],
  },
  {
    id: 'threat_analysis',
    name: 'Threat Analysis',
    description: 'Turrets prioritize missiles on course to hit living ground',
    branch: 'automation',
    col: -1,
    row: 5,
    maxLevel: 1,
    baseCost: 3150,
    costGrowth: 1,
    requires: ['bld_radar'],
    effects: [{ stat: 'threatTargeting', op: 'add', value: 1 }],
  },
  {
    id: 'neural_lead',
    name: 'Neural Lead',
    description: '-15% turret aim spread',
    branch: 'automation',
    col: -1,
    row: 6,
    maxLevel: 3,
    baseCost: 7350,
    costGrowth: 1.7,
    requires: ['threat_analysis'],
    effects: [{ stat: 'turretSpreadMul', op: 'mul', value: -0.15 }],
  },
  // Flak side-chain, east.
  {
    id: 'turret_flak',
    name: 'Flak',
    description: 'Deploy a Flak turret: air-burst area damage vs swarms (lvl = +dmg)',
    branch: 'automation',
    col: 1,
    row: 2,
    maxLevel: 5,
    baseCost: 490,
    costGrowth: 1.9,
    requires: ['turret_power'],
    effects: [],
  },
  {
    id: 'flak_payload',
    name: 'Heavy Payload',
    description: '+15% Flak burst radius',
    branch: 'automation',
    col: 1,
    row: 3,
    maxLevel: 5,
    baseCost: 1370,
    costGrowth: 1.8,
    requires: [{ id: 'turret_flak', level: 2 }],
    effects: [{ stat: 'flakRadiusMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'flak_fuses',
    name: 'Twin Fuses',
    description: '+20% Flak fire rate',
    branch: 'automation',
    col: 1,
    row: 4,
    maxLevel: 5,
    baseCost: 3350,
    costGrowth: 1.8,
    requires: [{ id: 'flak_payload', level: 2 }],
    effects: [{ stat: 'flakFireRateMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'flak_twin',
    name: 'Twin Flak',
    description: 'Deploy a second Flak on the left flank',
    branch: 'automation',
    col: 1,
    row: 5,
    maxLevel: 1,
    baseCost: 5400000,
    costGrowth: 1,
    tier: 3,
    requires: ['flak_fuses'],
    effects: [],
  },
  // Range / Mega Bomb / Railgun column, further east.
  {
    id: 'turret_range',
    name: 'Long Barrel',
    description: '+12% all turret range',
    branch: 'automation',
    col: 2,
    row: 2,
    maxLevel: 5,
    baseCost: 490,
    costGrowth: 1.6,
    requires: [{ id: 'turret_power', level: 2 }],
    effects: [{ stat: 'turretRangeMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'ability_megabomb',
    name: 'Mega Bomb',
    description: 'Manual: one huge explosion across the field. Levels add radius / damage / cut cooldown',
    branch: 'tech',
    col: 2,
    row: 3,
    maxLevel: 5,
    baseCost: 1330,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['turret_flak'],
    effects: [],
  },
  {
    id: 'turret_railgun',
    name: 'Railgun',
    description: 'Deploy a Railgun: piercing line shot through everything (lvl = +dmg)',
    branch: 'automation',
    col: 2,
    row: 4,
    maxLevel: 5,
    baseCost: 3850,
    costGrowth: 1.9,
    unlockCores: 1,
    requires: [{ id: 'turret_range', level: 3 }],
    effects: [],
  },
  {
    id: 'railgun_pierce',
    name: 'Sabot Rounds',
    description: '+2 Railgun pierce width',
    branch: 'automation',
    col: 2,
    row: 5,
    maxLevel: 3,
    baseCost: 4200,
    costGrowth: 1.9,
    requires: [{ id: 'turret_railgun', level: 2 }],
    effects: [{ stat: 'railgunPierceBonus', op: 'add', value: 2 }],
  },
  {
    id: 'railgun_caps',
    name: 'Rapid Capacitors',
    description: '+15% Railgun fire rate',
    branch: 'automation',
    col: 2,
    row: 6,
    maxLevel: 3,
    baseCost: 9100,
    costGrowth: 1.8,
    requires: ['railgun_pierce'],
    effects: [{ stat: 'railgunFireRateMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'railgun_twin',
    name: 'Twin Railgun',
    description: 'Deploy a second Railgun on the right flank',
    branch: 'automation',
    col: 2,
    row: 7,
    maxLevel: 1,
    baseCost: 8100000,
    costGrowth: 1,
    tier: 3,
    requires: ['railgun_caps'],
    effects: [],
  },
  // Tesla side-chain, far east.
  {
    id: 'turret_tesla',
    name: 'Tesla',
    description: 'Deploy a Tesla coil: chain lightning, last line of defence (lvl = +dmg)',
    branch: 'automation',
    col: 3,
    row: 3,
    maxLevel: 5,
    baseCost: 1400,
    costGrowth: 1.9,
    unlockCores: 1,
    requires: [{ id: 'turret_flak', level: 2 }],
    effects: [],
  },
  {
    id: 'tesla_arc',
    name: 'Arc Conductor',
    description: '+1 Tesla chain jump',
    branch: 'automation',
    col: 3,
    row: 4,
    maxLevel: 3,
    baseCost: 3500,
    costGrowth: 1.85,
    requires: [{ id: 'turret_tesla', level: 2 }],
    effects: [{ stat: 'teslaChainBonus', op: 'add', value: 1 }],
  },
  {
    id: 'tesla_voltage',
    name: 'High Voltage',
    description: '+25% Tesla damage',
    branch: 'automation',
    col: 3,
    row: 5,
    maxLevel: 5,
    baseCost: 8750,
    costGrowth: 1.8,
    requires: ['tesla_arc'],
    effects: [{ stat: 'teslaDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'tesla_twin',
    name: 'Twin Tesla',
    description: 'Deploy a second Tesla coil on the left flank',
    branch: 'automation',
    col: 3,
    row: 6,
    maxLevel: 1,
    baseCost: 7200000,
    costGrowth: 1,
    tier: 3,
    requires: [{ id: 'tesla_voltage', level: 2 }],
    effects: [],
  },

  // ═══ RIGHT · FOUNDATION — the economy trunk, support buildings above,
  //     city defence below. ════════════════════════════════════════════════
  {
    id: 'salvage',
    name: 'Salvage',
    description: '+8% scrap earned',
    branch: 'economy',
    col: 1,
    row: 0,
    maxLevel: 5,
    baseCost: 25,
    costGrowth: 1.55,
    requires: ['core'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.08 }],
  },
  {
    id: 'war_bonds',
    name: 'War Bonds',
    description: '+20% night-clear bonus',
    branch: 'economy',
    col: 2,
    row: 0,
    maxLevel: 3,
    baseCost: 300,
    costGrowth: 1.5,
    requires: [{ id: 'salvage', level: 4 }],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'refinery',
    name: 'Refinery',
    description: '+6% scrap earned',
    branch: 'economy',
    col: 3,
    row: 0,
    maxLevel: 5,
    baseCost: 490,
    costGrowth: 1.7,
    requires: [{ id: 'war_bonds', level: 2 }],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.06 }],
  },
  {
    id: 'reserves',
    name: 'Reserves',
    description: '+30% night-clear bonus',
    branch: 'economy',
    col: 4,
    row: 0,
    maxLevel: 3,
    baseCost: 1440,
    costGrowth: 1.7,
    requires: [{ id: 'refinery', level: 3 }],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.3 }],
  },
  {
    id: 'midas_protocol',
    name: 'Midas Protocol',
    description: '+15% scrap earned',
    branch: 'economy',
    col: 5,
    row: 0,
    maxLevel: 3,
    baseCost: 3850,
    costGrowth: 1.7,
    requires: [{ id: 'reserves', level: 2 }],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.15 }],
  },
  {
    // The REPEATABLE sink: near-unbounded, exponentially pricier each level.
    // It gives every scrap surplus somewhere to go and makes retrying a
    // walled gate productive — no build can be permanently stuck.
    id: 'war_effort',
    name: 'War Effort',
    description: '+2% ALL damage (turrets and blasts). No level cap',
    branch: 'economy',
    col: 6,
    row: 0,
    maxLevel: 200,
    baseCost: 40000,
    costGrowth: 1.09,
    tier: 2,
    requires: ['midas_protocol'],
    effects: [
      { stat: 'turretDamageMul', op: 'mul', value: 0.02 },
      { stat: 'explosionDamage', op: 'mul', value: 0.02 },
    ],
  },
  {
    id: 'salvage_core',
    name: 'Salvage Core',
    description: '+10% scrap earned',
    branch: 'economy',
    col: 6,
    row: -1,
    maxLevel: 3,
    baseCost: 400000,
    costGrowth: 1.8,
    tier: 2,
    requires: ['midas_protocol'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.1 }],
  },
  // Support-building side-chain, above the trunk.
  {
    id: 'chain_bounty',
    name: 'Chain Bounty',
    description: '+2 scrap when one explosion kills 3+',
    branch: 'economy',
    col: 1,
    row: -1,
    maxLevel: 3,
    baseCost: 250,
    costGrowth: 1.5,
    requires: [{ id: 'salvage', level: 2 }],
    effects: [{ stat: 'multiKillScrap', op: 'add', value: 2 }],
  },
  {
    id: 'bld_harvester',
    name: 'Scrap Harvester',
    description: 'Deploy: harvests scrap on its own all night (lvl = +rate)',
    branch: 'economy',
    col: 2,
    row: -1,
    maxLevel: 3,
    baseCost: 490,
    costGrowth: 1.9,
    requires: ['war_bonds'],
    effects: [],
  },
  {
    id: 'ability_surge',
    name: 'Scrap Surge',
    description: 'Manual: double all scrap earned for 10s. Levels extend duration / cut cooldown',
    branch: 'tech',
    col: 2,
    row: -2,
    maxLevel: 5,
    baseCost: 560,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['war_bonds'],
    effects: [],
  },
  {
    id: 'wave_dividend',
    name: 'Wave Dividend',
    description: '+5 scrap per wave survived',
    branch: 'economy',
    col: 3,
    row: -1,
    maxLevel: 3,
    baseCost: 1330,
    costGrowth: 1.5,
    requires: ['bld_harvester'],
    effects: [{ stat: 'waveClearScrap', op: 'add', value: 5 }],
  },
  {
    id: 'bld_jammer',
    name: 'Jammer Tower',
    description: 'Deploy: enemies inside its field are slowed (lvl = stronger)',
    branch: 'tech',
    col: 4,
    row: -1,
    maxLevel: 3,
    baseCost: 3500,
    costGrowth: 1.9,
    requires: ['wave_dividend'],
    effects: [],
  },
  {
    id: 'wide_spectrum',
    name: 'Wide Spectrum',
    description: '+20% Jammer field radius',
    branch: 'tech',
    col: 5,
    row: -1,
    maxLevel: 3,
    baseCost: 7350,
    costGrowth: 1.7,
    requires: [{ id: 'bld_jammer', level: 2 }],
    effects: [{ stat: 'jammerRadiusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'orbital_lance',
    name: 'Orbital Lance',
    description: 'A sky-beam slams the densest enemy column on a timer (lvl = faster)',
    branch: 'tech',
    col: 5,
    row: -2,
    maxLevel: 3,
    baseCost: 18000000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 4,
    requires: ['bld_jammer'],
    effects: [{ stat: 'lanceLevel', op: 'add', value: 1 }],
  },
  // City-defence side-chain, below the trunk.
  {
    id: 'reinforced',
    name: 'Reinforced',
    description: '+1 ground HP',
    branch: 'city',
    col: 1,
    row: 1,
    maxLevel: 3,
    baseCost: 260,
    costGrowth: 1.8,
    requires: ['salvage'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'bld_shield',
    name: 'Shield Generator',
    description: 'Deploy: absorbs 2 ground impacts each night (lvl = +1 charge)',
    branch: 'city',
    col: 2,
    row: 1,
    maxLevel: 3,
    baseCost: 630,
    costGrowth: 1.9,
    requires: [{ id: 'reinforced', level: 2 }],
    effects: [],
  },
  {
    id: 'compact',
    name: 'Bulwark',
    description: '+1 ground HP',
    branch: 'city',
    col: 3,
    row: 1,
    maxLevel: 3,
    baseCost: 1370,
    costGrowth: 1.6,
    requires: ['bld_shield'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'war_insurance',
    name: 'War Insurance',
    description: '+10 scrap compensation per ground hit',
    branch: 'city',
    col: 3,
    row: 2,
    maxLevel: 3,
    baseCost: 3150,
    costGrowth: 1.6,
    requires: ['compact'],
    effects: [{ stat: 'cityHitScrap', op: 'add', value: 10 }],
  },
  {
    id: 'bunker',
    name: 'Bunker',
    description: '+1 ground HP',
    branch: 'city',
    col: 4,
    row: 1,
    maxLevel: 3,
    baseCost: 3350,
    costGrowth: 1.9,
    requires: [{ id: 'compact', level: 2 }],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'bld_repair',
    name: 'Repair Bay',
    description: 'Deploy: repairs 1 ground HP every 40s (lvl shortens the timer)',
    branch: 'city',
    col: 4,
    row: 2,
    maxLevel: 3,
    baseCost: 8400,
    costGrowth: 1.9,
    requires: ['bunker'],
    effects: [],
  },
  {
    id: 'districts',
    name: 'Districts',
    description: 'Split the ground into +1 segment — damage lands more locally',
    branch: 'city',
    col: 5,
    row: 1,
    maxLevel: 3,
    baseCost: 9100,
    costGrowth: 1.7,
    requires: [{ id: 'bunker', level: 2 }],
    effects: [{ stat: 'cityCount', op: 'add', value: 1 }],
  },
  {
    id: 'bld_decoy',
    name: 'Decoy Beacon',
    description: 'Deploy: lures 30% of enemies to aim at it instead of the ground (lvl = +8%)',
    branch: 'city',
    col: 5,
    row: 2,
    maxLevel: 3,
    baseCost: 16800,
    costGrowth: 1.8,
    requires: ['bld_repair'],
    effects: [],
  },
  {
    id: 'bastion_core',
    name: 'Bastion Core',
    description: '+2 ground HP',
    branch: 'city',
    col: 6,
    row: 1,
    maxLevel: 3,
    baseCost: 19600,
    costGrowth: 1.7,
    requires: ['districts'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 2 }],
  },
  {
    id: 'aegis_dome',
    name: 'Aegis Dome',
    description: 'A shield dome over the field vaporises 3 enemies per night per level',
    branch: 'city',
    col: 6,
    row: 2,
    maxLevel: 3,
    baseCost: 14000000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 4,
    requires: ['districts'],
    effects: [{ stat: 'aegisCharges', op: 'add', value: 3 }],
  },

  // ═══ LEFT · OPS — the boss-token abilities. Their unlocks cost ◆, so this
  //     stub never competes with the scrap frontier. ═══════════════════════
  {
    id: 'ability_emp',
    name: 'EMP',
    description: 'Manual: freeze every enemy on screen briefly. Levels cut cooldown / extend freeze',
    branch: 'tech',
    col: -1,
    row: 0,
    maxLevel: 5,
    baseCost: 300,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['core'],
    effects: [],
  },
  {
    id: 'ability_freefire',
    name: 'Free Fire',
    description: 'Manual: a salvo of free shots — no drain, no reload. Levels add shots / cut cooldown',
    branch: 'tech',
    col: -2,
    row: 0,
    maxLevel: 5,
    baseCost: 560,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['ability_emp'],
    effects: [],
  },
  {
    id: 'flux_capacitor',
    name: 'Flux Capacitor',
    description: '-8% all ability cooldowns',
    branch: 'tech',
    col: -3,
    row: 0,
    maxLevel: 5,
    baseCost: 490,
    costGrowth: 1.6,
    requires: ['ability_freefire'],
    effects: [{ stat: 'abilityCooldownMul', op: 'mul', value: -0.08 }],
  },
  {
    id: 'singularity_core',
    name: 'Singularity Core',
    description: '-15% all ability cooldowns',
    branch: 'tech',
    col: -4,
    row: 0,
    maxLevel: 3,
    baseCost: 1500,
    costGrowth: 1.7,
    requires: [{ id: 'flux_capacitor', level: 3 }],
    effects: [{ stat: 'abilityCooldownMul', op: 'mul', value: -0.15 }],
  },
];

/** Map of turret tree-node ids to the turret kind they deploy. */
export const TURRET_NODES: Record<string, TurretKind> = {
  turret_gatling: 'gatling',
  turret_flak: 'flak',
  turret_laser: 'laser',
  turret_missile: 'missile',
  turret_railgun: 'railgun',
  turret_tesla: 'tesla',
};

export interface TurretSpec {
  kind: TurretKind;
  level: number;
  /** Deploy slot: 0 = the kind's home position, 1 = the twin on the other
   *  flank (see TURRETS[kind].x / .x2). */
  slot?: 0 | 1;
}

/** Twin-deployment nodes: field a SECOND copy of the kind on the other
 *  flank. The copy shares the deploy node's level (and every per-kind spec),
 *  so a full build has each turret once on each side of the cannon. */
export const TURRET_TWIN_NODES: Record<string, TurretKind> = {
  gatling_twin: 'gatling',
  flak_twin: 'flak',
  laser_twin: 'laser',
  missile_twin: 'missile',
  railgun_twin: 'railgun',
  tesla_twin: 'tesla',
};

/** Derive the deployed turret list (kind + node level) from tree levels. */
export function turretsFromTree(levels: TreeLevels): TurretSpec[] {
  const out: TurretSpec[] = [];
  for (const [nodeId, kind] of Object.entries(TURRET_NODES)) {
    const lvl = levels[nodeId] ?? 0;
    if (lvl > 0) out.push({ kind, level: lvl, slot: 0 });
  }
  for (const [nodeId, kind] of Object.entries(TURRET_TWIN_NODES)) {
    if ((levels[nodeId] ?? 0) <= 0) continue;
    const lvl = levels[`turret_${kind}`] ?? 0;
    if (lvl > 0) out.push({ kind, level: lvl, slot: 1 });
  }
  return out;
}

/** Map of building tree-node ids to the support building they deploy. */
export const BUILDING_NODES: Record<string, BuildingKind> = {
  bld_harvester: 'harvester',
  bld_shield: 'shield',
  bld_repair: 'repair',
  bld_radar: 'radar',
  bld_jammer: 'jammer',
  bld_decoy: 'decoy',
};

export interface BuildingSpec {
  kind: BuildingKind;
  level: number;
}

/** Derive the deployed support-building list (kind + node level) from the tree. */
export function buildingsFromTree(levels: TreeLevels): BuildingSpec[] {
  const out: BuildingSpec[] = [];
  for (const [nodeId, kind] of Object.entries(BUILDING_NODES)) {
    const lvl = levels[nodeId] ?? 0;
    if (lvl > 0) out.push({ kind, level: lvl });
  }
  return out;
}

/** Ability node levels (0 = not owned), keyed by ability kind. */
export interface AbilityLevels {
  emp: number;
  megabomb: number;
  freefire: number;
  surge: number;
}

export function abilitiesFromTree(levels: TreeLevels): AbilityLevels {
  return {
    emp: levels['ability_emp'] ?? 0,
    megabomb: levels['ability_megabomb'] ?? 0,
    freefire: levels['ability_freefire'] ?? 0,
    surge: levels['ability_surge'] ?? 0,
  };
}

export function getNode(id: string): TreeNode | undefined {
  return TREE.find((n) => n.id === id);
}

/** Price of the next level, or null if already maxed. Special nodes charge
 *  their FIRST level in cores (the boss token); everything else — including
 *  a special's later levels — follows the scrap curve. */
export interface NodePrice {
  currency: Currency;
  amount: number;
}
/** Snap a scrap price to a friendly step: two-digit prices land on 5s,
 *  everything above lands on a trailing zero — raw growth-curve numbers
 *  (⬡289, ⬡4864) read as noise in the shop. */
function prettyPrice(amount: number): number {
  if (amount < 100) return Math.max(5, Math.round(amount / 5) * 5);
  return Math.round(amount / 10) * 10;
}

export function nextPrice(node: TreeNode, currentLevel: number): NodePrice | null {
  if (currentLevel >= node.maxLevel) return null;
  if (currentLevel === 0 && node.unlockCores) {
    return { currency: 'cores', amount: node.unlockCores };
  }
  return {
    currency: nodeCurrency(node),
    amount: prettyPrice(node.baseCost * Math.pow(node.costGrowth, currentLevel)),
  };
}

/** A node's upgrade tier (1 unless declared higher). */
export function nodeTier(node: TreeNode): number {
  return node.tier ?? 1;
}

/** A node is unlocked once every prerequisite is at its required level AND
 *  its tier's world has been reached. `unlockedTier` defaults to all tiers
 *  so tier-agnostic callers (tests, tools) keep working. */
export function isUnlocked(node: TreeNode, levels: TreeLevels, unlockedTier = 4): boolean {
  if (nodeTier(node) > unlockedTier) return false;
  return node.requires.every((r) => (levels[reqId(r)] ?? 0) >= reqLevel(r));
}

/** A node is revealed (drawn — possibly as a locked silhouette naming its
 *  graduation gate) once every prerequisite is at least STARTED. Nodes
 *  beyond that stay fogged: the tree unfolds one step ahead of ownership. */
export function isRevealed(node: TreeNode, levels: TreeLevels): boolean {
  return node.requires.every((r) => (levels[reqId(r)] ?? 0) >= 1);
}

/** The first unmet prerequisite (for lock tooltips), or null when unlocked. */
export function missingRequirement(node: TreeNode, levels: TreeLevels): NodeRequirement | null {
  return node.requires.find((r) => (levels[reqId(r)] ?? 0) < reqLevel(r)) ?? null;
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
