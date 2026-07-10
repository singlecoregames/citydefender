import { BOSS_NIGHT_INTERVAL, NIGHT_SCALING, nightInWorld, worldOf } from './balance';
import type { EnemyKind } from './types';

/** One wave of a night: how many enemies and how fast they spawn, plus the
 *  per-night strength multipliers applied to each enemy in the wave. */
export interface WaveSpec {
  count: number;
  spawnIntervalRange: readonly [number, number];
  hpScale: number;
  speedScale: number;
  rewardScale: number;
}

/** Number of waves in a given night (capped — see NIGHT_SCALING.maxWaves). */
export function waveCountForNight(night: number): number {
  return Math.min(
    NIGHT_SCALING.maxWaves,
    NIGHT_SCALING.baseWaves + Math.floor(night / NIGHT_SCALING.nightsPerExtraWave),
  );
}

/** Volume pity: each consecutive defeat on a night thins its waves by this
 *  much, capped — the twin of ECONOMY.defeatPityPerFail. Scrap pity alone
 *  can't unstick a run whose next power step is token- or price-gated (the
 *  sim found single nasty night-rolls walling otherwise-healthy builds 7-8
 *  straight); volume pity guarantees convergence while leaving first-try
 *  difficulty untouched. */
export const VOLUME_PITY = { perFail: 0.05, cap: 0.25 } as const;

/**
 * Procedurally build a night's wave list from the night number. The per-wave
 * enemy cap climbs with the night, so the 200-night curve ends in massed
 * space-war floods rather than longer nights. Deterministic: the same night
 * and failStreak always produce the same spec, so saves and the balance sim
 * stay reproducible.
 */
export function generateNight(night: number, failStreak = 0): WaveSpec[] {
  const s = NIGHT_SCALING;
  const waveCap = s.maxWaveCount + s.waveCapPerNight * night;
  const spawnFloor = s.spawnIntervalFloor;
  const earlySpan = Math.min(
    Math.max(0, night - s.hpRampStartNight),
    s.hpPivotNight - s.hpRampStartNight,
  );
  // Past the pivot (= world 1's end) hp steps per world and regrows inside
  // the world, mirroring how kill pay is stepped — see NIGHT_SCALING.
  const world = worldOf(night);
  const lateSpan = night <= s.hpPivotNight ? 0 : world === 1 ? night - s.hpPivotNight : nightInWorld(night);
  const hpScale =
    Math.pow(s.hpGrowthEarly, earlySpan) *
    (night > s.hpPivotNight ? s.worldHpStep[world - 1] ?? 1 : 1) *
    Math.pow(s.hpGrowthLate, lateSpan);
  const speedScale = Math.min(s.speedCap, Math.pow(s.speedGrowth, night - 1));
  const rewardScale =
    (s.worldRewardStep[worldOf(night) - 1] ?? 1) *
    Math.pow(s.rewardGrowthInWorld, nightInWorld(night) - 1);
  const intervalScale = Math.pow(s.spawnIntervalDecayPerNight, night - 1);
  const [lo, hi] = s.spawnIntervalBase;

  const waves: WaveSpec[] = [];
  const count = waveCountForNight(night);
  // Boss nights thin the regular waves — the boss and its minions carry the
  // pressure, and its descent deadline is the real clock.
  const bossNight = night % BOSS_NIGHT_INTERVAL === 0;
  // The first two boss nights thin their waves harder: they're fought with
  // zero/one specials unlocked (tokens COME from these bosses), and the sim
  // showed unlucky seeds stuck 8 straight on N10 at the regular 0.75.
  const pity = 1 - Math.min(VOLUME_PITY.cap, VOLUME_PITY.perFail * failStreak);
  const countMul = (bossNight ? (night <= 20 ? 0.55 : 0.75) : 1) * pity;
  for (let w = 0; w < count; w++) {
    waves.push({
      count: Math.min(
        waveCap,
        Math.round((s.baseCount + w) * Math.pow(s.countGrowth, night - 1) * countMul),
      ),
      spawnIntervalRange: [
        Math.max(spawnFloor, lo * intervalScale - w * 0.04),
        Math.max(spawnFloor + 0.1, hi * intervalScale - w * 0.05),
      ],
      hpScale,
      speedScale,
      rewardScale,
    });
  }
  return waves;
}

export interface EnemyWeight {
  kind: EnemyKind;
  weight: number;
}

/**
 * Weighted pool of enemy kinds available on a given night. New kinds unlock as
 * nights progress; ballistic stays common early then thins out so later nights
 * feel varied. The sim's director draws from this each spawn.
 */
export function enemyPool(night: number): EnemyWeight[] {
  const pool: EnemyWeight[] = [{ kind: 'ballistic', weight: 10 }];
  if (night >= 3) pool.push({ kind: 'swarmer', weight: 5 });
  if (night >= 5) pool.push({ kind: 'splitter', weight: 5 });
  if (night >= 7) pool.push({ kind: 'regenerator', weight: 4 });
  // Phase walkers wait for the first boss token (N10): specials are the
  // counter-tools now, and their N9 debut stacked on the swarm-3-pack spike.
  if (night >= 11) pool.push({ kind: 'phase', weight: 4 });
  // Carriers ease in late and at half weight: their debut used to land on N12
  // together with the hp ramp, and the sim piled every world-1 fail onto that
  // single night (7-8 straight, a near-softlock at the 8-fail stuck limit).
  if (night >= 19) pool.push({ kind: 'carrier', weight: night >= 23 ? 2 : 1 });
  // Thin out plain ballistics once the roster fills in.
  if (night >= 10) pool[0]!.weight = 5;
  return pool;
}
