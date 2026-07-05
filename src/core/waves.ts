import { NIGHT_SCALING } from './balance';
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

/** Number of waves in a given night. */
export function waveCountForNight(night: number): number {
  return NIGHT_SCALING.baseWaves + Math.floor(night / NIGHT_SCALING.nightsPerExtraWave);
}

/**
 * Procedurally build a night's wave list from the night number. Deterministic:
 * the same night always produces the same spec, so saves and the balance sim
 * stay reproducible.
 */
export function generateNight(night: number): WaveSpec[] {
  const s = NIGHT_SCALING;
  const hpScale =
    (1 + s.hpLinearPerNight * (night - 1)) *
    Math.pow(s.hpGrowth, Math.max(0, night - s.hpRampStartNight));
  const speedScale = Math.pow(s.speedGrowth, night - 1);
  const rewardScale = Math.pow(s.rewardGrowth, night - 1);
  const intervalScale = Math.pow(s.spawnIntervalDecayPerNight, night - 1);
  const [lo, hi] = s.spawnIntervalBase;

  const waves: WaveSpec[] = [];
  const count = waveCountForNight(night);
  for (let w = 0; w < count; w++) {
    waves.push({
      count: Math.min(
        s.maxWaveCount,
        Math.round((s.baseCount + w) * Math.pow(s.countGrowth, night - 1)),
      ),
      spawnIntervalRange: [
        Math.max(s.spawnIntervalFloor, lo * intervalScale - w * 0.04),
        Math.max(s.spawnIntervalFloor + 0.1, hi * intervalScale - w * 0.05),
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
