import { BOSS_NIGHT_INTERVAL, NIGHT_SCALING } from './balance';
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

/**
 * Procedurally build a night's wave list from the night number. The per-wave
 * enemy cap climbs with the night, so the 200-night curve ends in massed
 * space-war floods rather than longer nights. Deterministic: the same night
 * always produces the same spec, so saves and the balance sim stay
 * reproducible.
 */
export function generateNight(night: number): WaveSpec[] {
  const s = NIGHT_SCALING;
  const waveCap = s.maxWaveCount + s.waveCapPerNight * night;
  const spawnFloor = s.spawnIntervalFloor;
  const earlySpan = Math.min(
    Math.max(0, night - s.hpRampStartNight),
    s.hpPivotNight - s.hpRampStartNight,
  );
  const hpScale =
    Math.pow(s.hpGrowthEarly, earlySpan) *
    Math.pow(s.hpGrowthLate, Math.max(0, night - s.hpPivotNight));
  const speedScale = Math.min(s.speedCap, Math.pow(s.speedGrowth, night - 1));
  const rewardScale = Math.pow(s.rewardGrowth, night - 1);
  const intervalScale = Math.pow(s.spawnIntervalDecayPerNight, night - 1);
  const [lo, hi] = s.spawnIntervalBase;

  const waves: WaveSpec[] = [];
  const count = waveCountForNight(night);
  // Boss nights thin the regular waves — the boss and its minions carry the
  // pressure, and its descent deadline is the real clock.
  const bossNight = night % BOSS_NIGHT_INTERVAL === 0;
  const countMul = bossNight ? 0.75 : 1;
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
  if (night >= 9) pool.push({ kind: 'phase', weight: 4 });
  if (night >= 12) pool.push({ kind: 'carrier', weight: 2 });
  // Thin out plain ballistics once the roster fills in.
  if (night >= 10) pool[0]!.weight = 5;
  return pool;
}
