import { CANNON, CITY, ECONOMY, EXPLOSION, SWEEP } from './balance';

/**
 * The fully-resolved numbers a single night's sim runs on. Base values come
 * from balance.ts; skill-tree nodes modify them. Keeping this as a flat record
 * lets node effects be declarative ({ stat, op, value }) instead of bespoke
 * code — the same mechanism across the whole tree.
 */
export interface DerivedStats {
  maxAmmo: number;
  reloadSeconds: number;
  interceptorSpeed: number;
  explosionMaxRadius: number;
  explosionDamage: number;
  /** Seconds between hold-to-fire shots while the pointer is held down. */
  holdFireInterval: number;
  /** Static Sweep: damage per zap (Static Charge). */
  sweepDamage: number;
  /** Sweep zaps add this fraction of total turret DPS, paid per hit interval
   *  (Static Link) — scrubbing scales with your automation like Overcharge. */
  sweepDpsRate: number;
  /** Static Sweep heat budget and refill rate (Heat Sink). */
  sweepHeatMax: number;
  sweepHeatRegen: number;
  /** Multiplier on all scrap earned during the night. */
  scrapMul: number;
  /** Multiplier on the night-completion bonus specifically. */
  nightBonusMul: number;
  /** Starting/max HP of each ground segment ("city"). */
  cityMaxHp: number;
  /** How many segments the ground is split into (more = finer damage). */
  cityCount: number;
  /** Global multipliers applied to every deployed turret (which turrets exist
   *  is decided by the tree's turret nodes, not by stats). */
  turretDamageMul: number;
  turretFireRateMul: number;
  turretRangeMul: number;
  /** Per-kind special upgrades (added on top of the kind's base spec). */
  teslaChainBonus: number; // extra chain jumps
  missileSalvoBonus: number; // extra missiles fired per volley
  railgunPierceBonus: number; // extra ray width
  flakRadiusMul: number; // burst radius multiplier
  laserDamageMul: number; // laser-only damage multiplier (tick dps)
  gatlingFireRateMul: number; // gatling-only fire rate multiplier
  /** Second-tier per-turret specialisations. */
  gatlingDamageMul: number;
  flakFireRateMul: number;
  laserRangeMul: number;
  missileDamageMul: number;
  railgunFireRateMul: number;
  teslaDamageMul: number;
  /** Multiplier on every manual-ability cooldown (Flux Capacitor / Singularity Core). */
  abilityCooldownMul: number;
  /** Flat scrap compensation each time a city takes a hit (War Insurance). */
  cityHitScrap: number;
  /** Flat scrap awarded when a wave finishes spawning (Wave Dividend). */
  waveClearScrap: number;
  /** Flat bonus scrap when one explosion kills 3+ enemies (Chain Bounty). */
  multiKillScrap: number;
  /** >0: turrets may target and damage phased enemies (Doppler Tracking). */
  dopplerTracking: number;
  /** Multiplier on the Jammer Tower's field radius (Wide Spectrum). */
  jammerRadiusMul: number;
  /** Manual explosions add this fraction of total turret DPS as bonus damage
   *  (Overcharge Shot) — manual fire scales with your automation. */
  overchargeRate: number;
  /** Fraction of the combo kept when it breaks (Combo Memory). */
  comboRetention: number;
  /** >0: turrets prefer enemies whose impact would hit a living city
   *  (Threat Analysis). */
  threatTargeting: number;
  /** Auto-Fire node level: 0 = the idle auto-fire is locked; higher levels
   *  arm it after a shorter idle wait (see autoFireThresholdFor). */
  autoFireLevel: number;
  /** Escort drones orbiting the cannon (Drone Escort, tier 2). */
  droneCount: number;
  /** MIRV level: interceptor blasts split into extra submunitions (tier 2). */
  mirvLevel: number;
  /** Orbital Lance level: periodic sky-beam strikes (tier 4, 0 = none). */
  lanceLevel: number;
  /** Aegis Dome charges per night (tier 4, 0 = no dome). */
  aegisCharges: number;
  /** Multiplier on every turret's aim spread, stacking with the Radar Array
   *  (Neural Lead). */
  turretSpreadMul: number;
}

export type StatKey = keyof DerivedStats;

export type StatOp = 'add' | 'mul';

export interface StatMod {
  stat: StatKey;
  op: StatOp;
  /** For 'mul' this is the per-level factor *increment* (e.g. 0.15 = +15%/lvl). */
  value: number;
}

export function baseStats(): DerivedStats {
  return {
    maxAmmo: CANNON.maxAmmo,
    reloadSeconds: CANNON.reloadSeconds,
    interceptorSpeed: CANNON.interceptorSpeed,
    explosionMaxRadius: EXPLOSION.maxRadius,
    explosionDamage: EXPLOSION.damage,
    holdFireInterval: CANNON.holdFireInterval,
    sweepDamage: SWEEP.damage,
    sweepDpsRate: 0,
    sweepHeatMax: SWEEP.heatMax,
    sweepHeatRegen: SWEEP.heatRegen,
    scrapMul: 1,
    nightBonusMul: 1,
    cityMaxHp: CITY.hp,
    cityCount: CITY.baseCount,
    turretDamageMul: 1,
    turretFireRateMul: 1,
    turretRangeMul: 1,
    teslaChainBonus: 0,
    missileSalvoBonus: 0,
    railgunPierceBonus: 0,
    flakRadiusMul: 1,
    laserDamageMul: 1,
    gatlingFireRateMul: 1,
    gatlingDamageMul: 1,
    flakFireRateMul: 1,
    laserRangeMul: 1,
    missileDamageMul: 1,
    railgunFireRateMul: 1,
    teslaDamageMul: 1,
    abilityCooldownMul: 1,
    cityHitScrap: 0,
    waveClearScrap: 0,
    multiKillScrap: 0,
    dopplerTracking: 0,
    jammerRadiusMul: 1,
    overchargeRate: 0,
    comboRetention: 0,
    threatTargeting: 0,
    autoFireLevel: 0,
    droneCount: 0,
    mirvLevel: 0,
    lanceLevel: 0,
    aegisCharges: 0,
    turretSpreadMul: 1,
  };
}

/** Apply a stat modifier `levels` times onto a stats object (mutates + returns). */
export function applyMod(stats: DerivedStats, mod: StatMod, levels: number): DerivedStats {
  if (levels <= 0) return stats;
  if (mod.op === 'add') {
    stats[mod.stat] += mod.value * levels;
  } else {
    stats[mod.stat] *= Math.pow(1 + mod.value, levels);
  }
  return stats;
}

export { ECONOMY };
