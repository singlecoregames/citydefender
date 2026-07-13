/**
 * Every tunable number in one place. The balance simulator (tools/sim)
 * sweeps these; gameplay code must not contain magic numbers.
 */
import type { BuildingKind, EnemyKind, TurretKind } from './types';

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
  /** The cannon is the BURST tool, not a parallel general attack (that is
   *  the static field's job): few rounds, long reload, huge blasts — every
   *  shot is a decision, closer to an ability than a machine gun. */
  maxAmmo: 2,
  /** Seconds to regenerate one round. */
  reloadSeconds: 4.0,
  /** Interceptor flight speed, world units per second. */
  interceptorSpeed: 70,
  /** Minimum target distance so you can't detonate inside the cannon. */
  minTargetDistance: 5,
  /** Idle auto-fire (gated behind the auto_fire tree node): once the magazine
   *  has sat FULL for this long with no player input, the cannon lead-aims
   *  and fires on its own — one shot per reload cycle (each shot drops the
   *  magazine off full; the next fires when it refills). A manual shot resets
   *  the timer. Extra node levels shave the wait, to a floor. */
  autoFireIdleSeconds: 4,
  autoFireIdlePerLevel: 1,
  autoFireIdleMin: 2,
  /** While a Free Fire salvo is being spent, the auto-fire ignores the reload
   *  cadence and dumps the free shots this fast — so leaving it to the
   *  cannon is nearly as quick as tapping the salvo out by hand. */
  autoFireBurstInterval: 0.28,
} as const;

/** Static Field: a circular aura that simply follows the pointer (no click
 *  needed) and periodically pulses, zapping and slowing every enemy inside.
 *  This is the PRIMARY attack — the cannon is the ammo-limited burst tool on
 *  top of it — so its baseline starts deliberately weak (small, slow) and
 *  the field ladder in the tree is what grows it into a weapon (playtest:
 *  the 9 / 0.9s launch values carried whole nights by themselves). The
 *  pulse cooldown (drawn as a ring-shaped progress bar around the circle)
 *  is the throughput limiter. The static also arcs through phase shields:
 *  the field is the manual counter to phased enemies (turrets still need
 *  Doppler Tracking). */
export const FIELD = {
  /** Aura radius (enemy half-extents are added on top, like every hit test).
   *  Maxed tree (Wide Field ×5, Field Coils ×3) reaches ≈ 12.4. */
  radius: 5.5,
  /** Base damage per pulse (see also the static_charge / static_link nodes).
   *  Stays at 1 despite the faster cadence below: 0.6 (naive DPS parity)
   *  broke the "one pulse kills an hp-1 enemy" breakpoint the whole early
   *  game is tuned around — the scripted player stopped clearing night 1.
   *  The resulting early-field buff is deliberate and sim-checked. The
   *  Static Link component needs no retune either way — its formula pays
   *  rate × turretDps × pulseSeconds, DPS-neutral under any cadence. */
  damage: 1,
  /** Seconds between pulses. A ready field with nothing in range HOLDS its
   *  charge — the first enemy to wander in is zapped immediately. Maxed
   *  tree (Pulse Cycle ×5, Field Coils ×3) reaches ≈ 0.69s. */
  pulseSeconds: 1.2,
  /** Zapped enemies move at this speed factor while the static lingers... */
  slowFactor: 0.6,
  /** ...for this long after the pulse. Trimmed 0.8 → 0.6 alongside the
   *  faster cadence: at 0.8 the maxed tree (≈0.69s pulses) would hit
   *  permanent slow. Uptime still rises (40% → 50% at base) — intended,
   *  the slow is half the reason the faster field feels responsive. Bosses
   *  are immune to the slow (their descent IS the fight timer) but still
   *  take the damage. */
  slowSeconds: 0.6,
} as const;

// NOTE: an "HQ integrity" mechanic lived here briefly (a global hp pool
// drained by impacts on dead ground, as the counter to the one-segment
// sacrifice strategy). Playtest verdict: too punishing in normal play even
// with breach-scaled leaks — rolled back wholesale. If the sacrifice
// strategy needs a counter again, try the ECONOMIC lever first (scrap
// multiplier scaled by living segments) instead of a survival clock.

/** Idle seconds before auto-fire arms at the given node level (0 = locked). */
export function autoFireThresholdFor(level: number): number {
  if (level <= 0) return 0;
  return Math.max(
    CANNON.autoFireIdleMin,
    CANNON.autoFireIdleSeconds - CANNON.autoFireIdlePerLevel * (level - 1),
  );
}

/** Cannon blast: sized for the burst role — one shot clears a cluster
 *  (the field handles the sustained trickle). Playtest: 13 made the manual
 *  shot dominate; the base starts tighter and the Blast Radius / Wide Blast
 *  ladder is what grows it (maxed ≈ 10 × 1.08^5 × 1.14^5 ≈ 28). */
export const EXPLOSION = {
  maxRadius: 10,
  /** At full blast radius from the instant of detonation... */
  holdSeconds: 0.45,
  /** ...then the radius shrinks to nothing over this long. */
  fadeSeconds: 0.3,
  damage: 3,
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

/** Children spawned mid-air (splitter death splits, carrier/boss sheds)
 *  START slow and accelerate to their intended speed: a split used to dump
 *  full-speed swarmers right where the player just spent a pulse/shell,
 *  with no window to react (playtest feedback — worst under the 2s pulse
 *  cycle). The ramp is the reaction window; the intended speed still
 *  arrives, just rampSeconds later. */
export const CHILD_SPAWN = {
  /** Fraction of the intended speed at the moment of spawning. */
  startFrac: 0.35,
  /** Seconds to ramp linearly from startFrac up to full speed. */
  rampSeconds: 2.5,
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
  /** Every hit is reduced by a flat armor value (scaled with the night's hp
   *  curve, like hp), floored at minDamageFrac of the raw hit — streams of
   *  small hits are blunted, single big hits barely notice. The counter to
   *  the gatling/pulse chip-damage meta once world 2 opens. */
  armored: { speed: 6, hp: 6, scrapReward: 14, armor: 1, minDamageFrac: 0.3 },
  /** Flies in from a side edge at altitude, bobbing on a sine wave, then
   *  dives once it passes over its target. The night's first horizontal
   *  threat axis: lead shots and jammer placement suddenly matter. */
  cruise: {
    speed: 10,
    hp: 4,
    scrapReward: 12,
    /** Dive speed = crossing speed × this. */
    diveSpeedMul: 1.5,
    /** Vertical bob velocity as a fraction of the crossing speed. */
    bobFrac: 0.45,
    /** Bob angular frequency (rad/s of the sine phase). */
    bobFrequency: 2.4,
    /** Crossing altitude is rolled in this world-y band. */
    altitudeRange: [68, 86],
  },
  /** Splits into ballistic warheads at mid altitude. The inverse of the
   *  splitter's punish: killing the bus BEFORE the split is pure profit —
   *  warheads pay no scrap and each must be shot down separately. */
  mirv: {
    speed: 7.5,
    hp: 3,
    scrapReward: 12,
    childCount: 3,
    /** Split altitude is rolled in this world-y band. */
    splitAltitude: [48, 64],
    /** Angular fan step between adjacent warheads (radians). */
    spreadRad: 0.5,
  },
  /** Slow support unit: periodically pulses, topping up every damaged
   *  non-boss enemy nearby. Stays high (slow descent), so ignoring it and
   *  focusing the low threats — the default targeting — feeds it. The
   *  priority-target enemy the Data targeting tree gets to answer. */
  healer: { speed: 4.5, hp: 6, scrapReward: 18, healRadius: 22, pulseInterval: 1.2, healPerPulse: 2 },
} as const;

/** Render size (full extent, world units) per enemy kind, with a capped
 *  hp-based bonus so late-game high-hp enemies read bigger without ballooning
 *  off-screen. Lives here (not the renderer) because hit tests use it too:
 *  what you see IS the collider — a boss drawn 22 wide must not require
 *  threading a shot through its 3.5-unit centre point. */
const ENEMY_BASE_SIZE: Partial<Record<EnemyKind, number>> = {
  swarmer: 2.2,
  regenerator: 4.4,
  carrier: 9,
  armored: 5,
  cruise: 5,
  mirv: 4.2,
  healer: 5.5,
};

export function enemySize(kind: EnemyKind, maxHp: number): number {
  if (kind === 'boss') return 22;
  const base = ENEMY_BASE_SIZE[kind] ?? 3.8;
  return base * (1 + Math.min(1.2, (maxHp - 1) * 0.03));
}

/** Collision half-extent: hit tests add this to their contact radii so big
 *  bodies are hit at their visual edge, not their centre. */
export function enemyHalfSize(kind: EnemyKind, maxHp: number): number {
  return enemySize(kind, maxHp) / 2;
}

/** How many swarmers spawn together when a swarm spawn is chosen. The pack
 *  grows with the night so their debut (N3, still manual-cannon-only) is a
 *  readable pair, not a full-size flood: 2 at N3–8, 3 at N9–13, 4 from N14.
 *  The 4-pack used to land at N12, stacking onto the hp ramp there — the sim
 *  piled 7-8 straight fails on that one night (a near-softlock); spreading
 *  the growth one night-band wider breaks up the spike. */
export const SWARMER_GROUP = 4;
export function swarmerGroupFor(night: number): number {
  return Math.min(SWARMER_GROUP, 2 + Math.floor(Math.max(0, night - 4) / 5));
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
    /** A field-covering blast: half the arena wide at level 1, growing to
     *  blanket almost all of it. */
    radius: 48,
    radiusPerLevel: 5,
    damage: 6,
    damagePerLevel: 3,
    /** Detonation height (world y). */
    y: 42,
  },
  freefire: {
    baseCooldown: 24,
    cooldownPerLevel: 1.8,
    minCooldown: 12,
    /** A salvo of free shots: each shot (manual OR auto) neither drains the
     *  magazine nor waits for the reload, but the salvo is capped at this many
     *  rounds — so hand-firing and auto-fire spend the same ammunition.
     *  (Halved when the cannon became the big-blast burst tool — six of the
     *  new shells was a rolling Mega Bomb.) */
    shots: 3,
    shotsPerLevel: 1,
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
  /** The multiplier is a MANUAL-skill reward, but it pays on every kill —
   *  turrets and auto-fire included. Without a decay, a streak built once
   *  kept paying while the player idled all night; now each idleBreakSeconds
   *  without a manual shot breaks the streak once (Combo Memory retention
   *  applies), so the boost fades stepwise unless you keep playing. */
  idleBreakSeconds: 8,
} as const;

/** Boss appears every BOSS_NIGHT_INTERVAL nights (N10, 20, 30…). */
export const BOSS_NIGHT_INTERVAL = 10;

export const BOSS = {
  /** Base hp before the night's hpScale (N10/20 only — worlds 2-4 use the
   *  gate interpolation). Sized for MANUAL kills: turrets always prefer the
   *  lowest enemy, so the boss is fought with the cannon while minions flood
   *  below — 55 was a knife-edge for unlucky no-special N10 builds. */
  hp: 40,
  /** World-end gate bosses (N30/60/90/120): absolute hp per world, sized so
   *  each falls to a build that has finished (or nearly finished) that
   *  world's REACHABLE spend — re-tuned when the banded tree rework
   *  stretched deep tier-1 rings into world 2 (the old 17000 gate assumed
   *  a tree bought out by ~N24; the banded tree deliberately isn't). */
  gateHp: [10000, 900000, 8500000, 40000000] as readonly number[],
  /** Mid-world bosses (N40, 50, 70, …) climb the GEOMETRIC path between the
   *  surrounding gates (prev × (next/prev)^(nightInWorld/30)) — each boss
   *  night is a checkpoint that ramps to the world's gate. Swarm nights
   *  can't carry this pressure: the sim shows turret DPS overkills wave hp
   *  until far past the point where gate fights become unwinnable, so the
   *  every-10th-night boss IS the difficulty spine of worlds 2-4. World 1
   *  keeps the plain hp-curve bosses (N10/20 are tuned around defeat pity). */
  /** Slow, relentless descent — reaching the ground ends the night, so this
   *  sets the kill window (~105s from spawn to touchdown). */
  speed: 1.1,
  scrapReward: 120,
  /** Seconds between shedding a minion, at full tempo (see bossSpawnInterval:
   *  the first bosses shed slower — the N10 fight is played with no specials
   *  unlocked yet, and the full 1.1s stream walled the sim there 8 straight). */
  spawnInterval: 1.1,
  spawnIntervalEarly: 3.0,
  /** Nights over which the early interval tapers down to full tempo. */
  spawnIntervalTaperNights: 20,
  /** Cores (◆) per boss kill — the ONLY ◆ source. One boss, one token;
   *  12 across the campaign vs 11 special-node unlocks (see tree.ts
   *  unlockCores), so each kill reads as "pick your next special".
   *  Playtest feedback drove the simplification: three currencies with
   *  formula-based trickles were unreadable. */
  coresPerKill: 1,
  /** Boss-hp pity: each consecutive defeat on a boss night shaves the
   *  boss's hp, capped. Volume/scrap pity never touched the boss itself,
   *  and on gate nights the boss IS the wall — sim + playtest both showed
   *  N30 retries not converging (7-8 straight at full 10000 hp while N29
   *  cleared first try). First-try difficulty is untouched. */
  hpPityPerFail: 0.07,
  hpPityCap: 0.3,
} as const;

/** Boss hp multiplier after `failStreak` consecutive defeats on this night. */
export function bossHpPityFactor(failStreak: number): number {
  return 1 - Math.min(BOSS.hpPityCap, BOSS.hpPityPerFail * failStreak);
}

export const ECONOMY = {
  /** Multiplier applied to all scrap when a night ends in defeat. */
  defeatScrapFactor: 0.6,
  /** Pity: each consecutive defeat on the same night raises the defeat
   *  payout by this much (capped at 1.0 — never above full value), so a
   *  walled player's economy recovers faster with every retry instead of
   *  grinding at 0.6 forever. Sim finding: without it, an unlucky seed
   *  loses the N10 boss 8 times straight and stalls at ~600⬡ banked. */
  defeatPityPerFail: 0.2,
  nightCompleteBonusBase: 70,
} as const;

/** Defeat payout multiplier after `failStreak` prior consecutive defeats on
 *  the night being retried (see ECONOMY.defeatPityPerFail). */
export function defeatScrapFactorFor(failStreak: number): number {
  return Math.min(1, ECONOMY.defeatScrapFactor + ECONOMY.defeatPityPerFail * failStreak);
}

/** Seconds between a boss shedding minions on `night` — slow for the first
 *  bosses, full tempo from N(10+taper) on. */
export function bossSpawnInterval(night: number): number {
  const t = Math.min(1, Math.max(0, (night - 10) / BOSS.spawnIntervalTaperNights));
  return BOSS.spawnIntervalEarly + (BOSS.spawnInterval - BOSS.spawnIntervalEarly) * t;
}


/** How a night's wave layout and enemy strength scale with the night number.
 *  Tuned so nights 1–3 stay gentle (exponentials start near 1) but the curve
 *  climbs hard after that — count and speed are the main pressure. */
export const NIGHT_SCALING = {
  /** Waves in night n = baseWaves + floor(n / nightsPerExtraWave), capped at
   *  maxWaves — past the cap, pressure rides on per-wave volume instead, so
   *  a 200-night run's nights stay minutes, not tens of minutes. */
  baseWaves: 4,
  nightsPerExtraWave: 3,
  maxWaves: 9,
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
  waveCapPerNight: 0.95,
  /** Per-night enemy hp, in two phases (see generateNight).
   *  WORLD 1 (to hpPivotNight): a steep exponential — it deliberately runs
   *  ahead of the scrap income so the tree purchases are what carry the
   *  player to the first gate (world 1's healthy 6-8 fails live here).
   *  WORLDS 2-4: hp STEPS at each world boundary (worldHpStep, mirroring
   *  worldRewardStep) and then regrows gently inside the world
   *  (hpGrowthLate per night-in-world). The step lands while the new
   *  world's tier is still unbought — the entry nights are the hard ones —
   *  and the in-world spend catches back up before the gate. A single
   *  smooth exponent can't do this: by the time world 2 feels it, world 4
   *  is unwinnable (sim: hpGrowthLate 1.09 → world 4 stuck, worlds 2-3
   *  still 0 fails). */
  hpGrowthEarly: 1.12,
  hpPivotNight: 30,
  hpGrowthLate: 1.045,
  worldHpStep: [1, 4, 16, 40] as readonly number[],
  /** The per-world hp step used to land in FULL on the world's first night —
   *  an ×4 cliff the entry build (its tier still unbought) piled defeats on.
   *  It now ramps in geometrically over this many nights, so a world opens
   *  hard-but-climbable and peaks at the intended step. */
  worldEntryRampNights: 5,
  hpRampStartNight: 9,
  /** Speed is unanswerable by upgrades, so it grows mildly and CAPS — an
   *  uncapped speed exponent was the old absolute-ceiling bug. */
  speedGrowth: 1.012,
  /** Kill pay is stepped PER WORLD, with only mild growth inside a world
   *  (~×4 across its 30 nights). A single per-night exponent compounded to
   *  ~×600 by N120, drowning every price; the steps keep each world's
   *  income in one order of magnitude so tier prices can be sized to it. */
  worldRewardStep: [1, 5, 20, 70] as readonly number[],
  rewardGrowthInWorld: 1.05,
  speedCap: 3.5,
  /** Spawn interval shrinks as nights progress (denser spawns). */
  spawnIntervalBase: [0.85, 1.3] as readonly [number, number],
  spawnIntervalFloor: 0.07,
  spawnIntervalDecayPerNight: 0.963,
} as const;

/** Seconds of breathing room between waves. */
export const WAVE_BREAK_SECONDS = 2.5;

/** The campaign: 4 worlds × 30 nights = 120 nights, one continuous run (no
 *  reset loop). Reaching world k unlocks upgrade tier k in the skill tree;
 *  higher tiers stay hidden until their world. */
export const WORLDS = {
  count: 4,
  nightsPerWorld: 30,
} as const;

/** 1-based world a night belongs to (clamped to the last world). */
export function worldOf(night: number): number {
  return Math.min(WORLDS.count, Math.floor((night - 1) / WORLDS.nightsPerWorld) + 1);
}

/** Night number within its world, 1..nightsPerWorld. */
export function nightInWorld(night: number): number {
  return ((night - 1) % WORLDS.nightsPerWorld) + 1;
}
