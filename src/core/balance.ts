/**
 * Every tunable number in one place. The balance simulator (tools/sim)
 * sweeps these; gameplay code must not contain magic numbers.
 */

/** Simulation runs at a fixed 60Hz regardless of render framerate. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** World space: x in [-100, 100], y in [0, 100]. Ground is y = 0. */
export const WORLD = {
  halfWidth: 100,
  height: 100,
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

export const CITY = {
  count: 3,
  /** Horizontal positions for the initial three cities. */
  xs: [-60, -30, 50] as readonly number[],
  hp: 1,
  /** An enemy impact within this distance damages the city. */
  hitRadius: 7,
} as const;

export const ENEMY = {
  ballistic: {
    speed: 9,
    hp: 1,
    scrapReward: 5,
  },
} as const;

export const ECONOMY = {
  /** Multiplier applied to all scrap when a night ends in defeat. */
  defeatScrapFactor: 0.6,
  nightCompleteBonusBase: 25,
  /** Night-completion bonus grows with the night number. */
  nightCompleteBonusGrowth: 1.15,
} as const;

/** How a night's wave layout and enemy strength scale with the night number. */
export const NIGHT_SCALING = {
  /** Waves in night n = baseWaves + floor(n / nightsPerExtraWave). */
  baseWaves: 3,
  nightsPerExtraWave: 2,
  /** Enemies in wave w of night n = round((baseCount + w) * countGrowth^n). */
  baseCount: 5,
  countGrowth: 1.05,
  /** Per-night multipliers applied to enemy hp / speed / reward. */
  hpGrowth: 1.1,
  speedGrowth: 1.02,
  rewardGrowth: 1.12,
  /** Spawn interval shrinks slightly as nights progress (faster spawns). */
  spawnIntervalBase: [0.85, 1.3] as readonly [number, number],
  spawnIntervalFloor: 0.4,
  spawnIntervalDecayPerNight: 0.98,
} as const;

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;
