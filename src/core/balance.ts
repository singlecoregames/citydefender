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
  /** Muzzle height: on top of the raised ground band. */
  y: 7.5,
  maxAmmo: 4,
  /** Seconds to regenerate one round. */
  reloadSeconds: 1.5,
  /** Interceptor flight speed, world units per second. */
  interceptorSpeed: 70,
  /** Minimum target distance so you can't detonate inside the cannon. */
  minTargetDistance: 5,
  /** Idle auto-fire (gated behind the auto_fire tree node): once the magazine
   *  has sat FULL for this long with no player input, the cannon lead-aims
   *  and fires on its own — one shot per reload cycle (each shot drops the
   *  magazine off full; the next fires when it refills). A manual shot resets
   *  the timer. Extra node levels shave the wait, to a floor. */
  autoFireIdleSeconds: 5,
  autoFireIdlePerLevel: 1,
  autoFireIdleMin: 3,
} as const;

/** Idle seconds before auto-fire arms at the given node level (0 = locked). */
export function autoFireThresholdFor(level: number): number {
  if (level <= 0) return 0;
  return Math.max(
    CANNON.autoFireIdleMin,
    CANNON.autoFireIdleSeconds - CANNON.autoFireIdlePerLevel * (level - 1),
  );
}

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
  /** Muzzle height: on top of the raised ground band. */
  y: 7.5,
  /** A contact projectile within this distance of an enemy hits it. */
  projectileHitRadius: 3.5,
  /** Per-node-level damage bonus: damage × (1 + levelDamageBonus × (level-1)). */
  levelDamageBonus: 0.3,
} as const;

export interface TurretKindSpec {
  /** Fixed deploy position for this turret kind. */
  x: number;
  /** Deploy position of the SECOND copy (the *_twin nodes) — always on the
   *  other side of the cannon, so a full build fields every kind once per
   *  side. Not mirror-symmetric; slots are picked to avoid the buildings. */
  x2: number;
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
  gatling: { x: -45, x2: 38, fireRate: 1.1, damage: 1, range: 58, projectileSpeed: 95, spreadDeg: 3.5 },
  flak: { x: 45, x2: -35, fireRate: 0.45, damage: 1, range: 70, projectileSpeed: 70, spreadDeg: 5, burstRadius: 5 },
  laser: { x: -80, x2: 62, fireRate: 0.8, damage: 1, range: 45 },
  missile: { x: 80, x2: -90, fireRate: 0.4, damage: 2, range: 85, homingSpeed: 38 },
  railgun: { x: -15, x2: 22, fireRate: 0.22, damage: 4, range: 95, pierceWidth: 3, spreadDeg: 1 },
  tesla: { x: 15, x2: -25, fireRate: 0.7, damage: 1, range: 30, chainCount: 4, chainRadius: 18 },
};

/** Shared support-building constants. Buildings sit on the ground line like
 *  turrets but never fire; each kind's effect scales with its node level. */
export const BUILDING = { y: 7.5 } as const;

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
  /** Ground segments the field starts with; upgrades split the ground finer.
   *  ("Cities" in code = the ground segments being defended.) */
  baseCount: 3,
  hp: 1,
  /** Top of the raised ground band (world y). Enemies detonate on reaching
   *  it, damaging whichever segment lies under the impact point. */
  groundTop: 4.5,
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

/** How many swarmers spawn together when a swarm spawn is chosen. The pack
 *  grows with the night so their debut (N3, still manual-cannon-only) is a
 *  readable pair, not a full-size flood: 2 at N3–7, 3 at N8–11, 4 from N12. */
export const SWARMER_GROUP = 4;
export function swarmerGroupFor(night: number): number {
  return Math.min(SWARMER_GROUP, 2 + Math.floor(Math.max(0, night - 4) / 4));
}

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
  freefire: {
    baseCooldown: 24,
    cooldownPerLevel: 1.8,
    minCooldown: 12,
    /** Seconds of unlimited manual ammo: shots neither drain the magazine
     *  nor wait for the reload while active. */
    duration: 4,
    durationPerLevel: 0.75,
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
  /** THE prestige walls. From wallFromNight on, boss hp switches to an
   *  absolute gate: wallHp × wallGrowth^(night − wallFromNight). wallHp is
   *  calibrated to the maxed scrap tree's kill capacity inside the descent
   *  window, so a ✦-less run walls at the N30 boss; each Arsenal Core level
   *  (×2 damage) buys log2/log(wallGrowth) ≈ 30 more nights — bosses every
   *  30 nights ARE the walls, and the swarm curve stays playable between. */
  wallFromNight: 30,
  wallHp: 110000,
  wallGrowth: 1.068,
  /** Past taperNight the wall curve relaxes: the full-✦ build (which walls
   *  around N140) outgrows it again at natural pace, opening the N140→200
   *  victory stretch to the ending. */
  wallTaperNight: 112,
  wallGrowthLate: 1.0,
  /** Slow, relentless descent — reaching the ground ends the night, so this
   *  sets the kill window (~105s from spawn to touchdown). */
  speed: 1.1,
  scrapReward: 120,
  /** Seconds between shedding a minion. */
  spawnInterval: 1.1,
  /** Cores awarded = coresBase + floor(night / BOSS_NIGHT_INTERVAL). */
  coresBase: 2,
} as const;

export const ECONOMY = {
  /** Multiplier applied to all scrap when a night ends in defeat. */
  defeatScrapFactor: 0.6,
  /** Pity: each consecutive defeat on the same night raises the defeat
   *  payout by this much (capped at 1.0 — never above full value), so a
   *  walled player's economy recovers faster with every retry instead of
   *  grinding at 0.6 forever. Sim finding: without it, an unlucky seed
   *  loses the N10 boss 8 times straight and stalls at ~600⬡ banked. */
  defeatPityPerFail: 0.15,
  nightCompleteBonusBase: 25,
  /** Night-completion bonus grows with the night number. */
  nightCompleteBonusGrowth: 1.15,
} as const;

/** Defeat payout multiplier after `failStreak` prior consecutive defeats on
 *  the night being retried (see ECONOMY.defeatPityPerFail). */
export function defeatScrapFactorFor(failStreak: number): number {
  return Math.min(1, ECONOMY.defeatScrapFactor + ECONOMY.defeatPityPerFail * failStreak);
}

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
  /** Waves in night n = baseWaves + floor(n / nightsPerExtraWave), capped at
   *  maxWaves — past the cap, pressure rides on per-wave volume instead, so
   *  a 200-night run's nights stay minutes, not tens of minutes. */
  baseWaves: 4,
  nightsPerExtraWave: 3,
  maxWaves: 10,
  /** Enemies in wave w of night n = round((baseCount + w) * countGrowth^n),
   *  capped at maxWaveCount. The cap bounds night length: spawn intervals
   *  bottom out at spawnIntervalFloor, so unbounded counts made N30+ nights
   *  physically longer than 10 minutes (balance-sim finding). Past the cap,
   *  difficulty rides on hp/speed instead of raw volume. */
  baseCount: 5,
  countGrowth: 1.05,
  /** Per-wave enemy cap = maxWaveCount + waveCapPerNight × night: volume is
   *  THE late-game pressure axis — by N200 waves are ~250-strong floods. */
  maxWaveCount: 28,
  waveCapPerNight: 1.1,
  /** Per-night enemy hp: an S-curve in two phases (see generateNight).
   *  EARLY (to hpPivotNight): steep — it deliberately outruns the finite
   *  scrap tree so a fresh, ✦-less run walls near the pivot: that wall IS
   *  the first prestige prompt. LATE (past the pivot): gentle — sized so
   *  each Arsenal Core level (×2 damage) buys roughly one wall interval
   *  (log2 / log hpGrowthLate ≈ 25-30 nights), giving the ~30-night wall
   *  cadence out to the N150 full-✦ finish and the N200 ending. */
  hpGrowthEarly: 1.17,
  hpPivotNight: 30,
  hpGrowthLate: 1.023,
  hpRampStartNight: 5,
  /** Speed is unanswerable by upgrades, so it grows mildly and CAPS — an
   *  uncapped speed exponent was the old absolute-ceiling bug. */
  speedGrowth: 1.012,
  speedCap: 3.5,
  /** Kill rewards must grow *slower* than node costs compound, or the tree
   *  maxes out mid-run and income loses its sink (sim: maxed by N13 at 1.13;
   *  at 1.07 cumulative income passed the whole tree's ~295k⬡ cost by ~N23
   *  and nights paid 35k+⬡ with nothing left to buy). 1.05 walls one sim
   *  seed at the N10 boss, so 1.06 is the floor that keeps every seed
   *  clearing. */
  rewardGrowth: 1.06,
  /** Spawn interval shrinks as nights progress (denser spawns). */
  spawnIntervalBase: [0.85, 1.3] as readonly [number, number],
  spawnIntervalFloor: 0.14,
  spawnIntervalDecayPerNight: 0.965,
} as const;

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;

/** Prestige: from minNight on, the Day screen offers a full reset back to
 *  night 1 for prestige points (✦) paid by depth reached. The 200-night
 *  curve outgrows the finite scrap tree, walling a run roughly every ~30
 *  nights — pushing past a wall takes the permanent ✦ upgrades (see
 *  core/prestige.ts). ✦ income is 1 per 10 nights reached, so the wall
 *  cadence (N30/60/90/120/150) banks 3+6+9+12+15 = 45✦ — exactly the cost
 *  of maxing every upgrade, which is why full completion lands near N150. */
export const PRESTIGE = {
  minNight: 20,
} as const;

export function prestigePoints(bestNight: number): number {
  if (bestNight < PRESTIGE.minNight) return 0;
  return Math.floor(bestNight / 10);
}
