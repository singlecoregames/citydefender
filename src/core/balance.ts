/**
 * Every tunable number in one place. The balance simulator (tools/sim)
 * sweeps these; gameplay code must not contain magic numbers.
 */
import type { TurretKind } from './types';

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
  growSeconds: 0.35,
  holdSeconds: 0.12,
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
  swarmer: { speed: 17, hp: 1, scrapReward: 2 },
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

export const ECONOMY = {
  /** Multiplier applied to all scrap when a night ends in defeat. */
  defeatScrapFactor: 0.6,
  nightCompleteBonusBase: 25,
  /** Night-completion bonus grows with the night number. */
  nightCompleteBonusGrowth: 1.15,
} as const;

/** How a night's wave layout and enemy strength scale with the night number.
 *  Tuned so nights 1–3 stay gentle (exponentials start near 1) but the curve
 *  climbs hard after that — count and speed are the main pressure. */
export const NIGHT_SCALING = {
  /** Waves in night n = baseWaves + floor(n / nightsPerExtraWave). */
  baseWaves: 3,
  nightsPerExtraWave: 2,
  /** Enemies in wave w of night n = round((baseCount + w) * countGrowth^n). */
  baseCount: 5,
  countGrowth: 1.09,
  /** Per-night enemy hp = round((1 + hpLinearPerNight*(n-1)) * hpGrowth^(n-1)).
   *  A linear term plus the exponential makes hp climb sooner and harder, so
   *  raw turret dps can't trivialise mid/late nights. */
  hpGrowth: 1.12,
  hpLinearPerNight: 0.08,
  speedGrowth: 1.035,
  rewardGrowth: 1.13,
  /** Spawn interval shrinks as nights progress (denser spawns). */
  spawnIntervalBase: [0.85, 1.3] as readonly [number, number],
  spawnIntervalFloor: 0.32,
  spawnIntervalDecayPerNight: 0.965,
} as const;

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;
