import { applyMod, baseStats, type DerivedStats, type StatMod } from './stats';
import type { BuildingKind, TurretKind } from './types';

export type TreeBranch = 'core' | 'cannon' | 'economy' | 'city' | 'automation' | 'tech';

/**
 * A single skill-tree node. Effects are declarative stat modifiers applied
 * `level` times. `requires` lists node ids that must have at least one level
 * before this node unlocks — that's what makes the tree branch. Grid `col`/`row`
 * place the node in the layout (the UI converts them to pixels); the tree fans
 * out from the centre: cannon up, economy left, city right.
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
  requires: string[];
  effects: StatMod[];
}

/** The currency a node is paid in. */
export function nodeCurrency(node: TreeNode): Currency {
  return node.currency ?? 'scrap';
}

export type TreeLevels = Record<string, number>;

/**
 * Skill tree — five directional paths off the centre, each a MIX of content
 * (a turret deploy, manual-cannon stats, an ability, economy…) so following
 * any one direction naturally picks up a bit of everything. A node's `branch`
 * still names its content type (colour in the UI); the paths are wired by
 * `requires`. Levels come in 1 / 3 / 5 — never more (splits, not ladders).
 *
 *   UP    gunner   — manual cannon + Laser turret
 *   DOWN  engineer — Gatling/Tesla + turret globals + Scrap Surge
 *   LEFT  quartermaster — economy + Flak turret + Mega Bomb
 *   RIGHT warden   — city defence + Missile Pod + ammo
 *   NW    operator — abilities + Radar + Railgun + turret range
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

  // Cost/value discipline: price follows GRAPH DEPTH from the core, strictly —
  // the tree must read inside-out. Tier-1 bases by ring: d1 ≈ 20–200⬡,
  // d2 ≈ 130–700⬡, d3 ≈ 550–1400⬡, d4 ≈ 1800–3500⬡, d5 ≈ 4500–6000⬡
  // (turret deploys sit at the top of their ring). Playtest finding: when a
  // d4 node undercuts a d2 node the shop stops reading as a progression.
  // SPECIAL nodes (unlockCores) charge their first level in boss tokens.

  // ── UP · gunner path: manual cannon, with the Laser turret grafted in ──
  {
    id: 'blast_radius',
    name: 'Blast Radius',
    description: '+8% explosion radius',
    branch: 'cannon',
    col: 0,
    row: -1,
    maxLevel: 5,
    baseCost: 20,
    costGrowth: 1.4,
    requires: ['core'],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.08 }],
  },
  {
    // The static sweep's stat ladder starts at ring 1: the sweep is the
    // early game's low-precision pressure valve, so its first upgrade must
    // be one of the first things a player can afford.
    id: 'static_charge',
    name: 'Static Charge',
    description: '+0.35 sweep zap damage',
    branch: 'cannon',
    col: 1,
    row: -1,
    maxLevel: 5,
    baseCost: 45,
    costGrowth: 1.5,
    requires: ['core'],
    effects: [{ stat: 'sweepDamage', op: 'add', value: 0.35 }],
  },
  {
    id: 'magazine',
    name: 'Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    col: -1,
    row: -2,
    maxLevel: 3,
    baseCost: 140,
    costGrowth: 1.5,
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
    maxLevel: 5,
    baseCost: 130,
    costGrowth: 1.45,
    requires: ['blast_radius'],
    effects: [{ stat: 'reloadSeconds', op: 'mul', value: -0.07 }],
  },
  {
    id: 'turret_laser',
    name: 'Laser',
    description: 'Deploy a Laser turret: short range, never misses (lvl = +dmg)',
    branch: 'automation',
    col: 0,
    row: -2,
    maxLevel: 5,
    baseCost: 500,
    costGrowth: 1.9,
    requires: ['blast_radius'],
    effects: [],
  },
  {
    id: 'wide_blast',
    name: 'Wide Blast',
    description: '+14% explosion radius',
    branch: 'cannon',
    col: -1,
    row: -3,
    maxLevel: 5,
    baseCost: 510,
    costGrowth: 1.55,
    requires: ['magazine'],
    effects: [{ stat: 'explosionMaxRadius', op: 'mul', value: 0.14 }],
  },
  {
    id: 'laser_focus',
    name: 'Focusing Lens',
    description: '+25% Laser damage',
    branch: 'automation',
    col: 0,
    row: -3,
    maxLevel: 5,
    baseCost: 640,
    costGrowth: 1.8,
    requires: ['turret_laser'],
    effects: [{ stat: 'laserDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'fast_intercept',
    name: 'Fast Intercept',
    description: '+10% interceptor speed',
    branch: 'cannon',
    col: 1,
    row: -3,
    maxLevel: 5,
    baseCost: 470,
    costGrowth: 1.5,
    requires: ['autoloader'],
    effects: [{ stat: 'interceptorSpeed', op: 'mul', value: 0.1 }],
  },
  {
    id: 'warhead',
    name: 'Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: 0,
    row: -4,
    maxLevel: 3,
    baseCost: 1600,
    costGrowth: 2.0,
    requires: ['wide_blast', 'fast_intercept'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'combo_memory',
    name: 'Combo Memory',
    description: 'Keep 25% of your combo when it breaks',
    branch: 'cannon',
    col: -1,
    row: -4,
    maxLevel: 3,
    baseCost: 1750,
    costGrowth: 1.7,
    requires: ['wide_blast'],
    effects: [{ stat: 'comboRetention', op: 'add', value: 0.25 }],
  },
  {
    id: 'overcharge_shot',
    name: 'Overcharge Shot',
    description: 'Manual blasts gain +4% of total turret DPS as damage',
    branch: 'cannon',
    col: 1,
    row: -4,
    maxLevel: 5,
    baseCost: 3600,
    costGrowth: 1.7,
    requires: ['warhead'],
    effects: [{ stat: 'overchargeRate', op: 'add', value: 0.04 }],
  },
  {
    id: 'heavy_warhead',
    name: 'Heavy Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: 0,
    row: -5,
    maxLevel: 3,
    baseCost: 4800,
    costGrowth: 2.2,
    requires: ['warhead'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
  },
  {
    id: 'static_link',
    name: 'Static Link',
    description: 'Sweep zaps gain +4% of total turret DPS as damage',
    branch: 'cannon',
    col: 1,
    row: -5,
    maxLevel: 5,
    baseCost: 6000,
    costGrowth: 1.7,
    requires: ['overcharge_shot'],
    effects: [{ stat: 'sweepDpsRate', op: 'add', value: 0.04 }],
  },
  {
    id: 'laser_reach',
    name: 'Beam Extender',
    description: '+15% Laser range',
    branch: 'automation',
    col: -1,
    row: -5,
    maxLevel: 3,
    baseCost: 1900,
    costGrowth: 1.8,
    requires: ['laser_focus'],
    effects: [{ stat: 'laserRangeMul', op: 'mul', value: 0.15 }],
  },

  // ── DOWN · engineer path: Gatling first, turret globals, Surge, Tesla ──
  {
    id: 'turret_gatling',
    name: 'Gatling',
    description: 'Deploy a Gatling turret: fast single-target fire (lvl = +30% dmg)',
    branch: 'automation',
    col: 0,
    row: 1,
    maxLevel: 5,
    baseCost: 200,
    costGrowth: 1.9,
    requires: ['core'],
    effects: [],
  },
  {
    id: 'auto_fire',
    name: 'Auto-Fire',
    description: 'Cannon fires by itself when idle with a full magazine (lvl = arms faster)',
    branch: 'automation',
    col: 2,
    row: 2,
    maxLevel: 3,
    baseCost: 260,
    costGrowth: 1.6,
    requires: ['turret_gatling'],
    effects: [{ stat: 'autoFireLevel', op: 'add', value: 1 }],
  },
  {
    id: 'turret_power',
    name: 'Turret Power',
    description: '+15% all turret damage',
    branch: 'automation',
    col: -1,
    row: 2,
    maxLevel: 5,
    baseCost: 240,
    costGrowth: 1.75,
    requires: ['turret_gatling'],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'gatling_spin',
    name: 'Spin-Up',
    description: '+18% Gatling fire rate',
    branch: 'automation',
    col: 0,
    row: 2,
    maxLevel: 5,
    baseCost: 260,
    costGrowth: 1.8,
    requires: ['turret_gatling'],
    effects: [{ stat: 'gatlingFireRateMul', op: 'mul', value: 0.18 }],
  },
  {
    id: 'turret_speed',
    name: 'Overdrive',
    description: '+12% all turret fire rate',
    branch: 'automation',
    col: 1,
    row: 2,
    maxLevel: 5,
    baseCost: 220,
    costGrowth: 1.75,
    requires: ['turret_gatling'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'overcharge_matrix',
    name: 'Overcharge Matrix',
    description: '+40% all turret damage',
    branch: 'automation',
    col: -2,
    row: 2,
    maxLevel: 5,
    baseCost: 1000,
    costGrowth: 1.75,
    requires: ['turret_power'],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.4 }],
  },
  {
    id: 'ability_surge',
    name: 'Scrap Surge',
    description: 'Manual: double all scrap earned for 10s. Levels extend duration / cut cooldown',
    branch: 'tech',
    col: -1,
    row: 3,
    maxLevel: 5,
    baseCost: 640,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['turret_power'],
    effects: [],
  },
  {
    id: 'turret_tesla',
    name: 'Tesla',
    description: 'Deploy a Tesla coil: chain lightning, last line of defence (lvl = +dmg)',
    branch: 'automation',
    col: 0,
    row: 3,
    maxLevel: 5,
    baseCost: 850,
    costGrowth: 1.9,
    unlockCores: 1,
    requires: ['gatling_spin'],
    effects: [],
  },
  {
    id: 'cooling_core',
    name: 'Cooling Core',
    description: '+25% all turret fire rate',
    branch: 'automation',
    col: 1,
    row: 3,
    maxLevel: 5,
    baseCost: 1100,
    costGrowth: 1.75,
    requires: ['turret_speed'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'gatling_belt',
    name: 'Tungsten Belt',
    description: '+25% Gatling damage',
    branch: 'automation',
    col: -2,
    row: 3,
    maxLevel: 5,
    baseCost: 850,
    costGrowth: 1.8,
    requires: ['gatling_spin'],
    effects: [{ stat: 'gatlingDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'turret_power2',
    name: 'Turret Power II',
    description: '+15% all turret damage',
    branch: 'automation',
    col: -1,
    row: 4,
    maxLevel: 5,
    baseCost: 2400,
    costGrowth: 1.75,
    requires: ['ability_surge'],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'tesla_arc',
    name: 'Arc Conductor',
    description: '+1 Tesla chain jump',
    branch: 'automation',
    col: 0,
    row: 4,
    maxLevel: 3,
    baseCost: 1750,
    costGrowth: 1.85,
    requires: ['turret_tesla'],
    effects: [{ stat: 'teslaChainBonus', op: 'add', value: 1 }],
  },
  {
    id: 'turret_speed2',
    name: 'Overdrive II',
    description: '+12% all turret fire rate',
    branch: 'automation',
    col: 1,
    row: 4,
    maxLevel: 5,
    baseCost: 1000,
    costGrowth: 1.75,
    requires: ['turret_speed'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'tesla_voltage',
    name: 'High Voltage',
    description: '+25% Tesla damage',
    branch: 'automation',
    col: 0,
    row: 5,
    maxLevel: 5,
    baseCost: 4400,
    costGrowth: 1.8,
    requires: ['tesla_arc'],
    effects: [{ stat: 'teslaDamageMul', op: 'mul', value: 0.25 }],
  },

  // ── LEFT · quartermaster path: economy, Flak turret, Mega Bomb ─────────
  {
    id: 'salvage',
    name: 'Salvage',
    description: '+8% scrap earned',
    branch: 'economy',
    col: -1,
    row: 0,
    maxLevel: 5,
    baseCost: 40,
    costGrowth: 1.55,
    requires: ['core'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.08 }],
  },
  {
    id: 'war_bonds',
    name: 'War Bonds',
    description: '+20% night-clear bonus',
    branch: 'economy',
    col: -2,
    row: 0,
    maxLevel: 3,
    baseCost: 160,
    costGrowth: 1.5,
    requires: ['salvage'],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'turret_flak',
    name: 'Flak',
    description: 'Deploy a Flak turret: air-burst area damage vs swarms (lvl = +dmg)',
    branch: 'automation',
    col: -2,
    row: 1,
    maxLevel: 5,
    baseCost: 450,
    costGrowth: 1.9,
    requires: ['salvage'],
    effects: [],
  },
  {
    id: 'chain_bounty',
    name: 'Chain Bounty',
    description: '+2 scrap when one explosion kills 3+',
    branch: 'economy',
    col: -1,
    row: 1,
    maxLevel: 3,
    baseCost: 160,
    costGrowth: 1.5,
    requires: ['salvage'],
    effects: [{ stat: 'multiKillScrap', op: 'add', value: 2 }],
  },
  {
    id: 'flak_payload',
    name: 'Heavy Payload',
    description: '+15% Flak burst radius',
    branch: 'automation',
    col: -3,
    row: 1,
    maxLevel: 5,
    baseCost: 600,
    costGrowth: 1.8,
    requires: ['turret_flak'],
    effects: [{ stat: 'flakRadiusMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'ability_megabomb',
    name: 'Mega Bomb',
    description: 'Manual: one huge explosion across the field. Levels add radius / damage / cut cooldown',
    branch: 'tech',
    col: -3,
    row: 2,
    maxLevel: 5,
    baseCost: 600,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['turret_flak'],
    effects: [],
  },
  {
    id: 'bld_harvester',
    name: 'Scrap Harvester',
    description: 'Deploy: harvests scrap on its own all night (lvl = +rate)',
    branch: 'economy',
    col: -3,
    row: 0,
    maxLevel: 3,
    baseCost: 600,
    costGrowth: 1.9,
    requires: ['war_bonds'],
    effects: [],
  },
  {
    id: 'refinery',
    name: 'Refinery',
    description: '+6% scrap earned',
    branch: 'economy',
    col: -3,
    row: -1,
    maxLevel: 5,
    baseCost: 640,
    costGrowth: 1.7,
    requires: ['war_bonds'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.06 }],
  },
  {
    id: 'wave_dividend',
    name: 'Wave Dividend',
    description: '+5 scrap per wave survived',
    branch: 'economy',
    col: -4,
    row: 0,
    maxLevel: 3,
    baseCost: 1450,
    costGrowth: 1.5,
    requires: ['bld_harvester'],
    effects: [{ stat: 'waveClearScrap', op: 'add', value: 5 }],
  },
  {
    id: 'reserves',
    name: 'Reserves',
    description: '+30% night-clear bonus',
    branch: 'economy',
    col: -4,
    row: 1,
    maxLevel: 3,
    baseCost: 1600,
    costGrowth: 1.7,
    requires: ['bld_harvester'],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.3 }],
  },
  {
    id: 'flak_fuses',
    name: 'Twin Fuses',
    description: '+20% Flak fire rate',
    branch: 'automation',
    col: -4,
    row: 2,
    maxLevel: 5,
    baseCost: 1900,
    costGrowth: 1.8,
    requires: ['flak_payload'],
    effects: [{ stat: 'flakFireRateMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'midas_protocol',
    name: 'Midas Protocol',
    description: '+15% scrap earned',
    branch: 'economy',
    col: -5,
    row: -1,
    maxLevel: 3,
    baseCost: 2100,
    costGrowth: 1.7,
    requires: ['refinery'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.15 }],
  },

  // ── RIGHT · warden path: ground defence, Missile Pod, spare ammo ───────
  {
    id: 'reinforced',
    name: 'Reinforced',
    description: '+1 ground HP',
    branch: 'city',
    col: 1,
    row: 0,
    maxLevel: 3,
    baseCost: 90,
    costGrowth: 1.8,
    requires: ['core'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'bld_shield',
    name: 'Shield Generator',
    description: 'Deploy: absorbs 2 ground impacts each night (lvl = +1 charge)',
    branch: 'city',
    col: 2,
    row: -1,
    maxLevel: 3,
    baseCost: 380,
    costGrowth: 1.9,
    requires: ['reinforced'],
    effects: [],
  },
  {
    id: 'turret_missile',
    name: 'Missile Pod',
    description: 'Deploy a Missile Pod: slow homing shots that never lose their prey (lvl = +dmg)',
    branch: 'automation',
    col: 2,
    row: 0,
    maxLevel: 5,
    baseCost: 600,
    costGrowth: 1.9,
    requires: ['reinforced'],
    effects: [],
  },
  {
    id: 'compact',
    name: 'Bulwark',
    description: '+1 ground HP',
    branch: 'city',
    col: 2,
    row: 1,
    maxLevel: 3,
    baseCost: 200,
    costGrowth: 1.6,
    requires: ['reinforced'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'drum_magazine',
    name: 'Drum Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    col: 2,
    row: -2,
    maxLevel: 3,
    baseCost: 550,
    costGrowth: 1.6,
    requires: ['bld_shield'],
    effects: [{ stat: 'maxAmmo', op: 'add', value: 1 }],
  },
  {
    // Warden flavour: heat/ammo management lives next to the Drum Magazine.
    id: 'heat_sink',
    name: 'Heat Sink',
    description: '+30 sweep heat, +15% heat regen',
    branch: 'cannon',
    col: 3,
    row: -3,
    maxLevel: 3,
    baseCost: 1800,
    costGrowth: 1.6,
    requires: ['drum_magazine'],
    effects: [
      { stat: 'sweepHeatMax', op: 'add', value: 30 },
      { stat: 'sweepHeatRegen', op: 'mul', value: 0.15 },
    ],
  },
  {
    id: 'rapid_trigger',
    name: 'Rapid Trigger',
    description: '-10% hold-fire interval',
    branch: 'cannon',
    col: 2,
    row: -4,
    maxLevel: 3,
    baseCost: 4500,
    costGrowth: 1.6,
    requires: ['heat_sink'],
    effects: [{ stat: 'holdFireInterval', op: 'mul', value: -0.1 }],
  },
  {
    id: 'missile_salvo',
    name: 'Salvo Rack',
    description: '+1 missile per volley',
    branch: 'automation',
    col: 3,
    row: 0,
    maxLevel: 3,
    baseCost: 810,
    costGrowth: 2.0,
    requires: ['turret_missile'],
    effects: [{ stat: 'missileSalvoBonus', op: 'add', value: 1 }],
  },
  {
    id: 'bunker',
    name: 'Bunker',
    description: '+1 ground HP',
    branch: 'city',
    col: 3,
    row: -1,
    maxLevel: 3,
    baseCost: 680,
    costGrowth: 1.9,
    requires: ['bld_shield'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'war_insurance',
    name: 'War Insurance',
    description: '+10 scrap compensation per ground hit',
    branch: 'city',
    col: 3,
    row: 1,
    maxLevel: 3,
    baseCost: 510,
    costGrowth: 1.6,
    requires: ['compact'],
    effects: [{ stat: 'cityHitScrap', op: 'add', value: 10 }],
  },
  {
    id: 'bld_decoy',
    name: 'Decoy Beacon',
    description: 'Deploy: lures 30% of enemies to aim at it instead of the ground (lvl = +8%)',
    branch: 'city',
    col: 4,
    row: 1,
    maxLevel: 3,
    baseCost: 810,
    costGrowth: 1.8,
    requires: ['compact'],
    effects: [],
  },
  {
    id: 'bld_repair',
    name: 'Repair Bay',
    description: 'Deploy: repairs 1 ground HP every 40s (lvl shortens the timer)',
    branch: 'city',
    col: 4,
    row: -1,
    maxLevel: 3,
    baseCost: 2000,
    costGrowth: 1.9,
    requires: ['bunker'],
    effects: [],
  },
  {
    id: 'bastion_core',
    name: 'Bastion Core',
    description: '+2 ground HP',
    branch: 'city',
    col: 3,
    row: -2,
    maxLevel: 3,
    baseCost: 2100,
    costGrowth: 1.7,
    requires: ['bunker'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 2 }],
  },
  {
    id: 'districts',
    name: 'Districts',
    description: 'Split the ground into +1 segment — damage lands more locally',
    branch: 'city',
    col: 4,
    row: 0,
    maxLevel: 3,
    baseCost: 2250,
    costGrowth: 1.7,
    requires: ['war_insurance'],
    effects: [{ stat: 'cityCount', op: 'add', value: 1 }],
  },
  {
    id: 'missile_warheads',
    name: 'Shaped Charges',
    description: '+30% Missile damage',
    branch: 'automation',
    col: 4,
    row: -2,
    maxLevel: 3,
    baseCost: 2250,
    costGrowth: 1.9,
    requires: ['missile_salvo'],
    effects: [{ stat: 'missileDamageMul', op: 'mul', value: 0.3 }],
  },

  // ── NW · operator path: abilities, Radar, Railgun, turret range ────────
  {
    id: 'ability_emp',
    name: 'EMP',
    description: 'Manual: freeze every enemy on screen briefly. Levels cut cooldown / extend freeze',
    branch: 'tech',
    col: -1,
    row: -1,
    maxLevel: 5,
    baseCost: 150,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['core'],
    effects: [],
  },
  {
    id: 'turret_range',
    name: 'Long Barrel',
    description: '+12% all turret range',
    branch: 'automation',
    col: -2,
    row: -1,
    maxLevel: 5,
    baseCost: 220,
    costGrowth: 1.6,
    requires: ['ability_emp'],
    effects: [{ stat: 'turretRangeMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'ability_freefire',
    name: 'Free Fire',
    description: 'Manual: a salvo of free shots — no drain, no reload. Levels add shots / cut cooldown',
    branch: 'tech',
    col: -2,
    row: -2,
    maxLevel: 5,
    baseCost: 320,
    costGrowth: 1.7,
    unlockCores: 1,
    requires: ['ability_emp'],
    effects: [],
  },
  {
    id: 'turret_railgun',
    name: 'Railgun',
    description: 'Deploy a Railgun: piercing line shot through everything (lvl = +dmg)',
    branch: 'automation',
    col: -3,
    row: -2,
    maxLevel: 5,
    baseCost: 1100,
    costGrowth: 1.9,
    unlockCores: 1,
    requires: ['turret_range'],
    effects: [],
  },
  {
    id: 'railgun_pierce',
    name: 'Sabot Rounds',
    description: '+2 Railgun pierce width',
    branch: 'automation',
    col: -4,
    row: -2,
    maxLevel: 3,
    baseCost: 2100,
    costGrowth: 1.9,
    requires: ['turret_railgun'],
    effects: [{ stat: 'railgunPierceBonus', op: 'add', value: 2 }],
  },
  {
    id: 'bld_radar',
    name: 'Radar Array',
    description: 'Deploy: tightens every turret’s aim (-15% spread per lvl)',
    branch: 'tech',
    col: -3,
    row: -3,
    maxLevel: 3,
    baseCost: 720,
    costGrowth: 1.9,
    requires: ['ability_freefire'],
    effects: [],
  },
  {
    id: 'flux_capacitor',
    name: 'Flux Capacitor',
    description: '-8% all ability cooldowns',
    branch: 'tech',
    col: -2,
    row: -3,
    maxLevel: 5,
    baseCost: 770,
    costGrowth: 1.6,
    requires: ['ability_freefire'],
    effects: [{ stat: 'abilityCooldownMul', op: 'mul', value: -0.08 }],
  },
  {
    id: 'doppler_tracking',
    name: 'Doppler Tracking',
    description: 'Radar lets turrets hit phased enemies',
    branch: 'tech',
    col: -3,
    row: -4,
    maxLevel: 1,
    baseCost: 2800,
    costGrowth: 1,
    requires: ['bld_radar'],
    effects: [{ stat: 'dopplerTracking', op: 'add', value: 1 }],
  },
  {
    id: 'threat_analysis',
    name: 'Threat Analysis',
    description: 'Turrets prioritize missiles on course to hit living ground',
    branch: 'automation',
    col: -4,
    row: -3,
    maxLevel: 1,
    baseCost: 2800,
    costGrowth: 1,
    requires: ['bld_radar'],
    effects: [{ stat: 'threatTargeting', op: 'add', value: 1 }],
  },
  {
    id: 'neural_lead',
    name: 'Neural Lead',
    description: '-15% turret aim spread',
    branch: 'automation',
    col: -5,
    row: -3,
    maxLevel: 3,
    baseCost: 4000,
    costGrowth: 1.7,
    requires: ['threat_analysis'],
    effects: [{ stat: 'turretSpreadMul', op: 'mul', value: -0.15 }],
  },
  {
    id: 'bld_jammer',
    name: 'Jammer Tower',
    description: 'Deploy: enemies inside its field are slowed (lvl = stronger)',
    branch: 'tech',
    col: -4,
    row: -4,
    maxLevel: 3,
    baseCost: 1900,
    costGrowth: 1.9,
    requires: ['bld_radar'],
    effects: [],
  },
  {
    id: 'wide_spectrum',
    name: 'Wide Spectrum',
    description: '+20% Jammer field radius',
    branch: 'tech',
    col: -5,
    row: -4,
    maxLevel: 3,
    baseCost: 3600,
    costGrowth: 1.7,
    requires: ['bld_jammer'],
    effects: [{ stat: 'jammerRadiusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'railgun_caps',
    name: 'Rapid Capacitors',
    description: '+15% Railgun fire rate',
    branch: 'automation',
    col: -5,
    row: -2,
    maxLevel: 3,
    baseCost: 4400,
    costGrowth: 1.8,
    requires: ['railgun_pierce'],
    effects: [{ stat: 'railgunFireRateMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'singularity_core',
    name: 'Singularity Core',
    description: '-15% all ability cooldowns',
    branch: 'tech',
    col: -2,
    row: -4,
    maxLevel: 3,
    baseCost: 2400,
    costGrowth: 1.7,
    requires: ['flux_capacitor'],
    effects: [{ stat: 'abilityCooldownMul', op: 'mul', value: -0.15 }],
  },

  // ── Tier 2 (world 2): the former prestige upgrades, now tree nodes ─────
  // Scrap prices from here up are sized to the world that unlocks the tier
  // (kill pay steps ×5/×20/×70 per world — see NIGHT_SCALING.worldRewardStep)
  // so the spend paces the world instead of being swallowed by the first
  // night's payout. SPECIALS charge their unlock in boss tokens on top.
  {
    id: 'arsenal_core',
    name: 'Arsenal Core',
    description: '+50% ALL damage (turrets and blasts)',
    branch: 'automation',
    col: 3,
    row: 2,
    maxLevel: 5,
    baseCost: 200000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 2,
    requires: ['turret_power'],
    effects: [
      { stat: 'turretDamageMul', op: 'mul', value: 0.5 },
      { stat: 'explosionDamage', op: 'mul', value: 0.5 },
    ],
  },
  {
    id: 'drone_escort',
    name: 'Drone Escort',
    description: 'Deploy an orbiting combat drone (+1 per level)',
    branch: 'automation',
    col: 3,
    row: 3,
    maxLevel: 3,
    baseCost: 350000,
    costGrowth: 1.9,
    unlockCores: 1,
    tier: 2,
    requires: ['auto_fire'],
    effects: [{ stat: 'droneCount', op: 'add', value: 1 }],
  },
  {
    id: 'mirv_warhead',
    name: 'MIRV Warhead',
    description: 'Interceptor blasts split into +2 submunitions per level',
    branch: 'cannon',
    col: 2,
    row: -3,
    maxLevel: 2,
    baseCost: 700000,
    costGrowth: 2.0,
    unlockCores: 1,
    tier: 2,
    requires: ['warhead'],
    effects: [{ stat: 'mirvLevel', op: 'add', value: 1 }],
  },
  {
    id: 'salvage_core',
    name: 'Salvage Core',
    description: '+10% scrap earned',
    branch: 'economy',
    col: -5,
    row: 0,
    maxLevel: 3,
    baseCost: 400000,
    costGrowth: 1.8,
    tier: 2,
    requires: ['refinery'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.1 }],
  },
  {
    // The REPEATABLE sink: near-unbounded, exponentially pricier each level.
    // It gives every scrap surplus somewhere to go (the campaign banks tens
    // of millions once a world's tier is bought out) and — critically — makes
    // retrying a walled gate productive: defeat-pity income converts to real
    // power here, so no build can be permanently stuck on a gate boss.
    id: 'war_effort',
    name: 'War Effort',
    description: '+2% ALL damage (turrets and blasts). No level cap',
    branch: 'economy',
    col: -5,
    row: 1,
    maxLevel: 200,
    baseCost: 40000,
    costGrowth: 1.09,
    tier: 2,
    requires: ['reserves'],
    effects: [
      { stat: 'turretDamageMul', op: 'mul', value: 0.02 },
      { stat: 'explosionDamage', op: 'mul', value: 0.02 },
    ],
  },

  // ── Tier 4 (world 4): the spectacle upgrades — token unlocks with
  //    world-4-scale scrap levels (they are world 4's only tier sink). ──────
  {
    id: 'orbital_lance',
    name: 'Orbital Lance',
    description: 'A sky-beam slams the densest enemy column on a timer (lvl = faster)',
    branch: 'tech',
    col: -4,
    row: -5,
    maxLevel: 3,
    baseCost: 18000000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 4,
    requires: ['bld_jammer'],
    effects: [{ stat: 'lanceLevel', op: 'add', value: 1 }],
  },
  {
    id: 'aegis_dome',
    name: 'Aegis Dome',
    description: 'A shield dome over the field vaporises 3 enemies per night per level',
    branch: 'city',
    col: 5,
    row: 0,
    maxLevel: 3,
    baseCost: 14000000,
    costGrowth: 1.7,
    unlockCores: 1,
    tier: 4,
    requires: ['districts'],
    effects: [{ stat: 'aegisCharges', op: 'add', value: 3 }],
  },

  // ── Twin deployments: outermost capstones — field a SECOND copy of the
  //    turret on the other flank, sharing its deploy level and specs.
  //    Tier 3: priced to world-3 kill pay (⬡55-60M/world), ~2/3 of it. ────
  {
    id: 'gatling_twin',
    name: 'Twin Gatling',
    description: 'Deploy a second Gatling on the right flank',
    branch: 'automation',
    col: -2,
    row: 4,
    maxLevel: 1,
    baseCost: 4500000,
    costGrowth: 1,
    tier: 3,
    requires: ['gatling_belt'],
    effects: [],
  },
  {
    id: 'tesla_twin',
    name: 'Twin Tesla',
    description: 'Deploy a second Tesla coil on the left flank',
    branch: 'automation',
    col: 1,
    row: 5,
    maxLevel: 1,
    baseCost: 7200000,
    costGrowth: 1,
    tier: 3,
    requires: ['tesla_voltage'],
    effects: [],
  },
  {
    id: 'laser_twin',
    name: 'Twin Laser',
    description: 'Deploy a second Laser on the right flank',
    branch: 'automation',
    col: -2,
    row: -5,
    maxLevel: 1,
    baseCost: 6300000,
    costGrowth: 1,
    tier: 3,
    requires: ['laser_reach'],
    effects: [],
  },
  {
    id: 'flak_twin',
    name: 'Twin Flak',
    description: 'Deploy a second Flak on the left flank',
    branch: 'automation',
    col: -5,
    row: 2,
    maxLevel: 1,
    baseCost: 5400000,
    costGrowth: 1,
    tier: 3,
    requires: ['flak_fuses'],
    effects: [],
  },
  {
    id: 'missile_twin',
    name: 'Twin Missile Pod',
    description: 'Deploy a second Missile Pod on the left flank',
    branch: 'automation',
    col: 5,
    row: -2,
    maxLevel: 1,
    baseCost: 7200000,
    costGrowth: 1,
    tier: 3,
    requires: ['missile_warheads'],
    effects: [],
  },
  {
    id: 'railgun_twin',
    name: 'Twin Railgun',
    description: 'Deploy a second Railgun on the right flank',
    branch: 'automation',
    col: -6,
    row: -2,
    maxLevel: 1,
    baseCost: 8100000,
    costGrowth: 1,
    tier: 3,
    requires: ['railgun_caps'],
    effects: [],
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
export function nextPrice(node: TreeNode, currentLevel: number): NodePrice | null {
  if (currentLevel >= node.maxLevel) return null;
  if (currentLevel === 0 && node.unlockCores) {
    return { currency: 'cores', amount: node.unlockCores };
  }
  return {
    currency: nodeCurrency(node),
    amount: Math.round(node.baseCost * Math.pow(node.costGrowth, currentLevel)),
  };
}

/** A node's upgrade tier (1 unless declared higher). */
export function nodeTier(node: TreeNode): number {
  return node.tier ?? 1;
}

/** A node is unlocked once every prerequisite has at least one level AND its
 *  tier's world has been reached. `unlockedTier` defaults to all tiers so
 *  tier-agnostic callers (tests, tools) keep working. */
export function isUnlocked(node: TreeNode, levels: TreeLevels, unlockedTier = 4): boolean {
  if (nodeTier(node) > unlockedTier) return false;
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
