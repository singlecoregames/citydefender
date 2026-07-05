/**
 * Every tunable number in one place. The balance simulator (tools/sim)
 * sweeps these; gameplay code must not contain magic numbers.
 */
import type { BuildingKind, TurretKind } from './types';

/** Simulation runs at a fixed 60Hz regardless of render framerate. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** World space: x in [-100, 100], y in [0, 100]. Ground is y = 0. */
export const WORLD = {
  halfWidth: 100,
  height: 100,
  /** Enemies spawn this far above the visible top so they fly in from
   *  off-screen, giving the player more time to react. */
  spawnMargin: 22,
} as const;

export const CANNON = {
  x: 0,
  y: 3,
  maxAmmo: 6,
  /** Seconds to regenerate one round. */
  reloadSeconds: 1.5,
  /** Interceptor flight speed, world units per second. */
  interceptorSpeed: 70,
  /** Minimum target distance so you can't detonate inside the cannon. */
  minTargetDistance: 5,
} as const;

export const EXPLOSION = {
  maxRadius: 8,
  /** At full blast radius from the instant of detonation... */
  holdSeconds: 0.45,
  /** ...then the radius shrinks to nothing over this long. */
  fadeSeconds: 0.3,
  damage: 1,
} as const;

/** Shared turret constants. */
export const TURRET = {
  y: 2,
  /** A contact projectile within this distance of an enemy hits it. */
  projectileHitRadius: 3.5,
  /** Per-node-level damage bonus: damage × (1 + levelDamageBonus × (level-1)). */
  levelDamageBonus: 0.3,
} as const;

export interface TurretKindSpec {
  /** Fixed deploy position for this turret kind. */
  x: number;
  /** Shots (or bursts/beam ticks) per second. */
  fireRate: number;
  damage: number;
  range: number;
  /** Ballistic kinds: projectile flight speed. */
  projectileSpeed?: number;
  /** Ballistic kinds: random aim error in ± degrees. */
  spreadDeg?: number;
  /** Flak: radius of the air-burst explosion. */
  burstRadius?: number;
  /** Missile: homing flight speed. */
  homingSpeed?: number;
  /** Railgun: enemies within this distance of the ray are hit. */
  pierceWidth?: number;
  /** Tesla: max chained targets and jump distance between them. */
  chainCount?: number;
  chainRadius?: number;
}

/**
 * The six turret kinds. Distinct roles: gatling = cheap single-target dps,
 * flak = area denial vs swarms, laser = never-miss counter to tough enemies,
 * missile = guaranteed slow homing kill, railgun = piercing burst, tesla =
 * short-range last line of defence.
 */
export const TURRETS: Record<TurretKind, TurretKindSpec> = {
  gatling: { x: -45, fireRate: 1.1, damage: 1, range: 58, projectileSpeed: 95, spreadDeg: 3.5 },
  flak: { x: 45, fireRate: 0.45, damage: 1, range: 70, projectileSpeed: 70, spreadDeg: 5, burstRadius: 5 },
  laser: { x: -80, fireRate: 0.8, damage: 1, range: 45 },
  missile: { x: 80, fireRate: 0.4, damage: 2, range: 85, homingSpeed: 38 },
  railgun: { x: -15, fireRate: 0.22, damage: 4, range: 95, pierceWidth: 3, spreadDeg: 1 },
  tesla: { x: 15, fireRate: 0.7, damage: 1, range: 30, chainCount: 4, chainRadius: 18 },
};

/** Shared support-building constants. Buildings sit on the ground line like
 *  turrets but never fire; each kind's effect scales with its node level. */
export const BUILDING = { y: 2 } as const;

export interface BuildingKindSpec {
  /** Fixed deploy position (chosen to sit between turrets/cities). */
  x: number;
}

export const BUILDINGS: Record<BuildingKind, BuildingKindSpec> = {
  /** Scrap Harvester: passive income — scrap/sec = ratePerLevel × level. */
  harvester: { x: 30 },
  /** Shield Generator: absorbs ground impacts — charges = base + perLevel×(lvl-1). */
  shield: { x: -70 },
  /** Repair Bay: heals 1 city HP every `interval` seconds (shrinks with level). */
  repair: { x: 70 },
  /** Radar Array: tightens every turret's aim spread. */
  radar: { x: -55 },
  /** Jammer Tower: slows enemies inside its field. */
  jammer: { x: 55 },
  /** Decoy Beacon: lures a share of enemies to target it instead of cities. */
  decoy: { x: 90 },
} as const;

/** Per-kind building tuning, separate from positions for the balance sim. */
export const BUILDING_TUNING = {
  harvester: { scrapPerSecPerLevel: 0.8 },
  shield: { chargesBase: 2, chargesPerLevel: 1 },
  repair: { intervalBase: 40, intervalPerLevel: 7, intervalMin: 18, healAmount: 1 },
  /** Aim spread is multiplied by spreadMulPerLevel^level (lvl 4 ≈ −48%). */
  radar: { spreadMulPerLevel: 0.85 },
  /** Slow = slowBase + slowPerLevel×(lvl−1), applied inside radius. */
  jammer: { radius: 45, slowBase: 0.12, slowPerLevel: 0.06 },
  /** Each spawn rolls pullBase + pullPerLevel×(lvl−1) to aim at the decoy. */
  decoy: { pullBase: 0.3, pullPerLevel: 0.08, jitter: 6 },
} as const;

export const CITY = {
  count: 3,
  /** Horizontal positions for the initial three cities. */
  xs: [-60, -30, 50] as readonly number[],
  hp: 1,
  /** An enemy impact within this distance damages the city. */
  hitRadius: 7,
} as const;

export const ENEMY = {
  ballistic: { speed: 9, hp: 1, scrapReward: 5 },
  /** Small, fast, fragile — comes in groups. */
  swarmer: { speed: 15.3, hp: 1, scrapReward: 2 },
  /** Splits into 2 swarmers on death. */
  splitter: { speed: 8, hp: 2, scrapReward: 6, childCount: 2 },
  /** Heals back up if left alone for regenDelay seconds. */
  regenerator: { speed: 7, hp: 5, scrapReward: 9, regenDelay: 1.4, regenPerSec: 3 },
  /** Periodically goes untargetable/invulnerable. */
  phase: { speed: 8.5, hp: 2, scrapReward: 7, phaseInterval: 1.5, phaseDuration: 0.7 },
  /** Slow, tanky; drips out swarmers as it descends. */
  carrier: { speed: 4, hp: 10, scrapReward: 22, spawnInterval: 1.6 },
} as const;

/** How many swarmers spawn together when a swarm spawn is chosen. */
export const SWARMER_GROUP = 4;

/** Manual abilities (Tech branch). Each unlock node level reduces cooldown and
 *  boosts effect; level 0 = not owned. */
export const ABILITIES = {
  emp: {
    /** Cooldown seconds at level 1, reduced per extra level. */
    baseCooldown: 18,
    cooldownPerLevel: 1.6,
    minCooldown: 8,
    /** Freeze duration (s) at level 1, extended per level. */
    freeze: 1.6,
    freezePerLevel: 0.25,
  },
  megabomb: {
    baseCooldown: 22,
    cooldownPerLevel: 1.6,
    minCooldown: 10,
    radius: 28,
    radiusPerLevel: 3,
    damage: 6,
    damagePerLevel: 3,
    /** Detonation height (world y). */
    y: 42,
  },
  slowmo: {
    baseCooldown: 20,
    cooldownPerLevel: 1.5,
    minCooldown: 10,
    /** Enemy speed multiplier while active. */
    factor: 0.4,
    duration: 4,
    durationPerLevel: 0.6,
  },
  surge: {
    baseCooldown: 30,
    cooldownPerLevel: 2,
    minCooldown: 16,
    /** Scrap multiplier while active. */
    factor: 2,
    duration: 10,
    durationPerLevel: 1,
  },
} as const;

/** Combo meter: consecutive manual-explosion kills build a global scrap
 *  multiplier. A manual blast that kills nothing, or a city taking damage,
 *  breaks the streak (Combo Memory retains a fraction). */
export const COMBO = {
  /** Scrap multiplier = 1 + scrapPerStack × min(combo, maxStacks). */
  scrapPerStack: 0.02,
  maxStacks: 50,
} as const;

/** Data (▣) — the skilled-play currency. Earned only on victorious nights
 *  from night `unlockNight` on: a perfect-defence bonus plus a peak-combo
 *  bonus. Spent on the automation-intelligence nodes. */
export const DATA = {
  unlockNight: 20,
  /** Perfect night (cities took zero damage): perfectBase + floor(night/10). */
  perfectBase: 2,
  /** 1 data per this much peak combo, capped at comboDataCap. */
  comboPerData: 20,
  comboDataCap: 3,
} as const;

/** Boss appears every BOSS_NIGHT_INTERVAL nights (N10, 20, 30…). */
export const BOSS_NIGHT_INTERVAL = 10;

export const BOSS = {
  /** Base hp before the night's hpScale; very tanky. */
  hp: 55,
  /** Very slow descent — it looms rather than races. */
  speed: 1.6,
  scrapReward: 120,
  /** Seconds between shedding a minion. */
  spawnInterval: 1.1,
  /** Cores awarded = coresBase + floor(night / BOSS_NIGHT_INTERVAL). */
  coresBase: 2,
  /** Hovers at this height, descending only slowly, so the fight has room. */
  hoverY: 80,
} as const;

export const ECONOMY = {
  /** Multiplier applied to all scrap when a night ends in defeat. */
  defeatScrapFactor: 0.6,
  nightCompleteBonusBase: 25,
  /** Night-completion bonus grows with the night number. */
  nightCompleteBonusGrowth: 1.15,
} as const;

/** Cores trickle from clearing a night for the first time (on top of boss
 *  drops) — the sim showed boss-only supply (~25◆ to N50) starves the ◆ tree. */
export const FIRST_CLEAR = {
  /** First clears from this night on pay cores. */
  fromNight: 10,
  /** Cores = base + floor(night / scaleNights). */
  base: 1,
  scaleNights: 25,
} as const;

/** How a night's wave layout and enemy strength scale with the night number.
 *  Tuned so nights 1–3 stay gentle (exponentials start near 1) but the curve
 *  climbs hard after that — count and speed are the main pressure. */
export const NIGHT_SCALING = {
  /** Waves in night n = baseWaves + floor(n / nightsPerExtraWave). */
  baseWaves: 4,
  nightsPerExtraWave: 3,
  /** Enemies in wave w of night n = round((baseCount + w) * countGrowth^n),
   *  capped at maxWaveCount. The cap bounds night length: spawn intervals
   *  bottom out at spawnIntervalFloor, so unbounded counts made N30+ nights
   *  physically longer than 10 minutes (balance-sim finding). Past the cap,
   *  difficulty rides on hp/speed instead of raw volume. */
  baseCount: 5,
  countGrowth: 1.05,
  maxWaveCount: 28,
  /** Per-night enemy hp =
   *  round((1 + hpLinearPerNight*(n-1)) * hpGrowth^max(0, n-hpRampStartNight)).
   *  A linear term plus the exponential makes hp climb sooner and harder, so
   *  raw turret dps can't trivialise mid/late nights. hpRampStartNight delays
   *  the exponential's onset: the manual-only opening nights (before the first
   *  turrets and damage nodes) stay at ~base hp, and the ramp only bites once
   *  the player has tools. Balance-sim findings: with the ramp starting at N1
   *  the scripted player walled at N6–N10 (repeated 0/3-city defeats) right
   *  where the first 2-hp ballistics landed; starting the ramp at N4 pushes
   *  the first 2-hp enemies to N8 and clears the wall, while N50 hp stays in
   *  the same order (×277 vs ×403 — late nights were already comfortable). */
  hpGrowth: 1.13,
  hpRampStartNight: 4,
  hpLinearPerNight: 0,
  speedGrowth: 1.035,
  /** Kill rewards must grow *slower* than node costs compound, or the tree
   *  maxes out mid-run and income loses its sink (sim: maxed by N13 at 1.13). */
  rewardGrowth: 1.07,
  /** Spawn interval shrinks as nights progress (denser spawns). */
  spawnIntervalBase: [0.85, 1.3] as readonly [number, number],
  spawnIntervalFloor: 0.32,
  spawnIntervalDecayPerNight: 0.965,
} as const;

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;
