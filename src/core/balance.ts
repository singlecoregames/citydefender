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
} as const;

/** Night 1 layout used by the M1 prototype; later replaced by waves/waveTable. */
export const NIGHT1_WAVES: readonly { count: number; spawnIntervalRange: readonly [number, number] }[] = [
  { count: 6, spawnIntervalRange: [0.9, 1.4] },
  { count: 8, spawnIntervalRange: [0.7, 1.2] },
  { count: 10, spawnIntervalRange: [0.55, 1.0] },
];

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;
