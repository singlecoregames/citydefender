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
export type Currency = 'scrap' | 'cores' | 'data';

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
    id: 'magazine',
    name: 'Magazine',
    description: '+1 max ammo',
    branch: 'cannon',
    col: -1,
    row: -2,
    maxLevel: 3,
    baseCost: 22,
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
    baseCost: 28,
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
    baseCost: 380,
    costGrowth: 1.9,
    requires: ['blast_radius'],
    effects: [],
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
    id: 'laser_focus',
    name: 'Focusing Lens',
    description: '+25% Laser damage',
    branch: 'automation',
    col: 0,
    row: -3,
    maxLevel: 5,
    baseCost: 260,
    costGrowth: 1.8,
    requires: ['turret_laser'],
    effects: [{ stat: 'laserDamageMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'fast_intercept',
    name: 'Fast Intercept',
    description: '+7% interceptor speed',
    branch: 'cannon',
    col: 1,
    row: -3,
    maxLevel: 5,
    baseCost: 24,
    costGrowth: 1.4,
    requires: ['autoloader'],
    effects: [{ stat: 'interceptorSpeed', op: 'mul', value: 0.07 }],
  },
  {
    id: 'warhead',
    name: 'Warhead',
    description: '+1 explosion damage',
    branch: 'cannon',
    col: 0,
    row: -4,
    maxLevel: 3,
    baseCost: 90,
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
    baseCost: 2,
    costGrowth: 1.7,
    currency: 'data',
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
    baseCost: 200,
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
    baseCost: 260,
    costGrowth: 2.3,
    requires: ['warhead'],
    effects: [{ stat: 'explosionDamage', op: 'add', value: 1 }],
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
    baseCost: 180,
    costGrowth: 1.9,
    requires: ['core'],
    effects: [],
  },
  {
    id: 'turret_power',
    name: 'Turret Power',
    description: '+15% all turret damage',
    branch: 'automation',
    col: -1,
    row: 2,
    maxLevel: 5,
    baseCost: 130,
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
    baseCost: 160,
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
    baseCost: 110,
    costGrowth: 1.75,
    requires: ['turret_gatling'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'ability_surge',
    name: 'Scrap Surge',
    description: 'Manual: double all scrap earned for 10s. Levels extend duration / cut cooldown',
    branch: 'tech',
    col: -1,
    row: 3,
    maxLevel: 5,
    baseCost: 160,
    costGrowth: 1.7,
    requires: ['turret_power'],
    effects: [],
  },
  {
    id: 'overcharge_matrix',
    name: 'Overcharge Matrix',
    description: '+40% all turret damage',
    branch: 'automation',
    col: -2,
    row: 2,
    maxLevel: 5,
    baseCost: 3,
    costGrowth: 1.6,
    currency: 'cores',
    requires: ['turret_power'],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.4 }],
  },
  {
    id: 'turret_power2',
    name: 'Turret Power II',
    description: '+15% all turret damage',
    branch: 'automation',
    col: -1,
    row: 4,
    maxLevel: 5,
    baseCost: 1400,
    costGrowth: 1.75,
    requires: ['ability_surge'],
    effects: [{ stat: 'turretDamageMul', op: 'mul', value: 0.15 }],
  },
  {
    id: 'turret_tesla',
    name: 'Tesla',
    description: 'Deploy a Tesla coil: chain lightning, last line of defence (lvl = +dmg)',
    branch: 'automation',
    col: 0,
    row: 3,
    maxLevel: 5,
    baseCost: 450,
    costGrowth: 1.9,
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
    baseCost: 4,
    costGrowth: 1.6,
    currency: 'cores',
    requires: ['turret_speed'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.25 }],
  },
  {
    id: 'turret_speed2',
    name: 'Overdrive II',
    description: '+12% all turret fire rate',
    branch: 'automation',
    col: 1,
    row: 4,
    maxLevel: 5,
    baseCost: 1200,
    costGrowth: 1.75,
    requires: ['turret_speed'],
    effects: [{ stat: 'turretFireRateMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'tesla_arc',
    name: 'Arc Conductor',
    description: '+1 Tesla chain jump',
    branch: 'automation',
    col: 0,
    row: 4,
    maxLevel: 3,
    baseCost: 320,
    costGrowth: 1.85,
    requires: ['turret_tesla'],
    effects: [{ stat: 'teslaChainBonus', op: 'add', value: 1 }],
  },

  // ── LEFT · quartermaster path: economy, Flak turret, Mega Bomb ─────────
  {
    id: 'salvage',
    name: 'Salvage',
    description: '+12% scrap earned',
    branch: 'economy',
    col: -1,
    row: 0,
    maxLevel: 5,
    baseCost: 40,
    costGrowth: 1.55,
    requires: ['core'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'war_bonds',
    name: 'War Bonds',
    description: '+20% night-clear bonus',
    branch: 'economy',
    col: -2,
    row: 0,
    maxLevel: 3,
    baseCost: 60,
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
    baseCost: 320,
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
    baseCost: 90,
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
    baseCost: 240,
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
    baseCost: 150,
    costGrowth: 1.7,
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
    baseCost: 250,
    costGrowth: 1.9,
    requires: ['war_bonds'],
    effects: [],
  },
  {
    id: 'refinery',
    name: 'Refinery',
    description: '+10% scrap earned',
    branch: 'economy',
    col: -3,
    row: -1,
    maxLevel: 5,
    baseCost: 120,
    costGrowth: 1.75,
    requires: ['war_bonds'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.1 }],
  },
  {
    id: 'wave_dividend',
    name: 'Wave Dividend',
    description: '+3 scrap per wave survived',
    branch: 'economy',
    col: -4,
    row: 0,
    maxLevel: 3,
    baseCost: 70,
    costGrowth: 1.5,
    requires: ['bld_harvester'],
    effects: [{ stat: 'waveClearScrap', op: 'add', value: 3 }],
  },
  {
    id: 'reserves',
    name: 'Reserves',
    description: '+30% night-clear bonus',
    branch: 'economy',
    col: -4,
    row: 1,
    maxLevel: 3,
    baseCost: 200,
    costGrowth: 1.7,
    requires: ['bld_harvester'],
    effects: [{ stat: 'nightBonusMul', op: 'mul', value: 0.3 }],
  },
  {
    id: 'compound_interest',
    name: 'Compound Interest',
    description: '+4% of unspent scrap each dawn',
    branch: 'economy',
    col: -4,
    row: -1,
    maxLevel: 3,
    baseCost: 150,
    costGrowth: 1.7,
    requires: ['refinery'],
    effects: [{ stat: 'scrapInterestRate', op: 'add', value: 0.04 }],
  },
  {
    id: 'midas_protocol',
    name: 'Midas Protocol',
    description: '+25% scrap earned',
    branch: 'economy',
    col: -5,
    row: -1,
    maxLevel: 3,
    baseCost: 3,
    costGrowth: 1.7,
    currency: 'cores',
    requires: ['compound_interest'],
    effects: [{ stat: 'scrapMul', op: 'mul', value: 0.25 }],
  },

  // ── RIGHT · warden path: city defence, Missile Pod, spare ammo ────────
  {
    id: 'reinforced',
    name: 'Reinforced',
    description: '+1 ground HP',
    branch: 'city',
    col: 1,
    row: 0,
    maxLevel: 3,
    baseCost: 80,
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
    baseCost: 300,
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
    baseCost: 70,
    costGrowth: 1.55,
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
    baseCost: 110,
    costGrowth: 1.6,
    requires: ['bld_shield'],
    effects: [{ stat: 'maxAmmo', op: 'add', value: 1 }],
  },
  {
    id: 'missile_salvo',
    name: 'Salvo Rack',
    description: '+1 missile per volley',
    branch: 'automation',
    col: 3,
    row: 0,
    maxLevel: 3,
    baseCost: 420,
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
    baseCost: 220,
    costGrowth: 2.0,
    requires: ['bld_shield'],
    effects: [{ stat: 'cityMaxHp', op: 'add', value: 1 }],
  },
  {
    id: 'war_insurance',
    name: 'War Insurance',
    description: '+8 scrap compensation per city hit',
    branch: 'city',
    col: 3,
    row: 1,
    maxLevel: 3,
    baseCost: 120,
    costGrowth: 1.6,
    requires: ['compact'],
    effects: [{ stat: 'cityHitScrap', op: 'add', value: 8 }],
  },
  {
    id: 'bld_decoy',
    name: 'Decoy Beacon',
    description: 'Deploy: lures 30% of enemies to aim at it instead of cities (lvl = +8%)',
    branch: 'city',
    col: 4,
    row: 1,
    maxLevel: 3,
    baseCost: 280,
    costGrowth: 1.8,
    requires: ['compact'],
    effects: [],
  },
  {
    id: 'bld_repair',
    name: 'Repair Bay',
    description: 'Deploy: repairs 1 city HP every 40s (lvl shortens the timer)',
    branch: 'city',
    col: 4,
    row: -1,
    maxLevel: 3,
    baseCost: 400,
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
    baseCost: 3,
    costGrowth: 1.7,
    currency: 'cores',
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
    baseCost: 3,
    costGrowth: 1.7,
    currency: 'cores',
    requires: ['war_insurance'],
    effects: [{ stat: 'cityCount', op: 'add', value: 1 }],
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
    baseCost: 120,
    costGrowth: 1.7,
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
    baseCost: 90,
    costGrowth: 1.55,
    requires: ['ability_emp'],
    effects: [{ stat: 'turretRangeMul', op: 'mul', value: 0.12 }],
  },
  {
    id: 'ability_slowmo',
    name: 'Time Dilation',
    description: 'Manual: slow all enemies for a few seconds. Levels extend duration / cut cooldown',
    branch: 'tech',
    col: -2,
    row: -2,
    maxLevel: 5,
    baseCost: 140,
    costGrowth: 1.7,
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
    baseCost: 750,
    costGrowth: 1.9,
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
    baseCost: 480,
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
    baseCost: 350,
    costGrowth: 1.9,
    requires: ['ability_slowmo'],
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
    baseCost: 200,
    costGrowth: 1.6,
    requires: ['ability_slowmo'],
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
    baseCost: 600,
    costGrowth: 1,
    requires: ['bld_radar'],
    effects: [{ stat: 'dopplerTracking', op: 'add', value: 1 }],
  },
  {
    id: 'threat_analysis',
    name: 'Threat Analysis',
    description: 'Turrets prioritize missiles on course to hit a city',
    branch: 'automation',
    col: -4,
    row: -3,
    maxLevel: 1,
    baseCost: 4,
    costGrowth: 1,
    currency: 'data',
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
    baseCost: 2,
    costGrowth: 1.7,
    currency: 'data',
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
    baseCost: 380,
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
    baseCost: 250,
    costGrowth: 1.7,
    requires: ['bld_jammer'],
    effects: [{ stat: 'jammerRadiusMul', op: 'mul', value: 0.2 }],
  },
  {
    id: 'singularity_core',
    name: 'Singularity Core',
    description: '-15% all ability cooldowns',
    branch: 'tech',
    col: -2,
    row: -4,
    maxLevel: 3,
    baseCost: 4,
    costGrowth: 1.7,
    currency: 'cores',
    requires: ['flux_capacitor'],
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
}

/** Derive the deployed turret list (kind + node level) from tree levels. */
export function turretsFromTree(levels: TreeLevels): TurretSpec[] {
  const out: TurretSpec[] = [];
  for (const [nodeId, kind] of Object.entries(TURRET_NODES)) {
    const lvl = levels[nodeId] ?? 0;
    if (lvl > 0) out.push({ kind, level: lvl });
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
  slowmo: number;
  surge: number;
}

export function abilitiesFromTree(levels: TreeLevels): AbilityLevels {
  return {
    emp: levels['ability_emp'] ?? 0,
    megabomb: levels['ability_megabomb'] ?? 0,
    slowmo: levels['ability_slowmo'] ?? 0,
    surge: levels['ability_surge'] ?? 0,
  };
}

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
