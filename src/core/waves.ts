import { NIGHT_SCALING } from './balance';

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
  const hpScale = Math.pow(s.hpGrowth, night - 1);
  const speedScale = Math.pow(s.speedGrowth, night - 1);
  const rewardScale = Math.pow(s.rewardGrowth, night - 1);
  const intervalScale = Math.pow(s.spawnIntervalDecayPerNight, night - 1);
  const [lo, hi] = s.spawnIntervalBase;

  const waves: WaveSpec[] = [];
  const count = waveCountForNight(night);
  for (let w = 0; w < count; w++) {
    waves.push({
      count: Math.round((s.baseCount + w) * Math.pow(s.countGrowth, night - 1)),
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
