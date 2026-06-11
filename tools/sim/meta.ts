/**
 * Full-run driver: plays night after night with the scripted AI, mirroring
 * the real meta loop in src/main.ts (night → dawn payout → shopping → next
 * night; defeats retry the same night). Produces one record per night played.
 */
import { BOSS_NIGHT_INTERVAL, ECONOMY, TICK_RATE } from '../../src/core/balance';
import {
  dawnInterest,
  firstClearCores,
  newRun,
  nightSeed,
  type RunState,
} from '../../src/core/run';
import { Sim, type NightConfig } from '../../src/core/sim';
import {
  abilitiesFromTree,
  buildingsFromTree,
  resolveStats,
  turretsFromTree,
} from '../../src/core/tree';
import { generateNight } from '../../src/core/waves';
import { NightAi } from './ai';
import { shop, type StrategyName } from './strategy';

export interface SimulateOptions {
  seed: number;
  /** Run ends once this night has been cleared (or the run gets stuck). */
  targetNight: number;
  strategy: StrategyName;
  /** 0..1 — manual-play quality of the scripted player. */
  skill: number;
  /** Hard cap per night; hitting it counts as a timeout (stalemate). */
  maxNightSeconds: number;
  /** Give up after this many consecutive non-victories on one night. */
  stuckLimit: number;
}

export const DEFAULT_OPTIONS: SimulateOptions = {
  seed: 1,
  targetNight: 50,
  strategy: 'smart',
  skill: 0.7,
  maxNightSeconds: 600,
  stuckLimit: 8,
};

export type NightOutcome = 'victory' | 'defeat' | 'timeout';

export interface NightRecord {
  night: number;
  /** 1-based try counter for this night (defeats retry the same night). */
  attempt: number;
  outcome: NightOutcome;
  durationSec: number;
  scrapEarned: number;
  coresEarned: number;
  dataEarned: number;
  maxCombo: number;
  citiesLeft: number;
  /** Node ids bought at the following dawn (repeats = multiple levels). */
  purchases: string[];
  /** Banks after shopping. */
  bank: { scrap: number; cores: number; data: number };
}

export interface RunReport {
  options: SimulateOptions;
  records: NightRecord[];
  run: RunState;
  /** Whether targetNight was cleared. */
  cleared: boolean;
  /** True when the run was abandoned after stuckLimit consecutive failures. */
  stuck: boolean;
}

/** Mirrors nightConfigFor() in src/main.ts. */
export function nightConfigFor(run: RunState): NightConfig {
  return {
    night: run.night,
    waves: generateNight(run.night),
    stats: resolveStats(run.upgrades),
    turrets: turretsFromTree(run.upgrades),
    buildings: buildingsFromTree(run.upgrades),
    abilities: abilitiesFromTree(run.upgrades),
    boss: run.night % BOSS_NIGHT_INTERVAL === 0,
  };
}

/** Play one night to completion (or timeout) and return its record fields. */
export function playNight(
  run: RunState,
  opts: SimulateOptions,
  attempt: number,
): Omit<NightRecord, 'night' | 'attempt' | 'purchases' | 'bank'> {
  const cfg = nightConfigFor(run);
  // The night seed matches the real game; the AI gets its own stream so
  // retries of the same night play out differently (as a human would).
  const sim = new Sim(nightSeed(run), cfg);
  const ai = new NightAi((opts.seed * 7919 + run.night * 101 + attempt) >>> 0, opts.skill, cfg);

  const maxTicks = opts.maxNightSeconds * TICK_RATE;
  let outcome: NightOutcome = 'timeout';
  let scrapEarned = 0;
  let coresEarned = 0;
  let dataEarned = 0;
  let ticks = 0;
  while (sim.state.phase === 'playing' && ticks < maxTicks) {
    const events = sim.step(ai.commands(sim.state));
    ticks++;
    for (const ev of events) {
      if (ev.type === 'bossKilled') coresEarned += ev.cores;
      else if (ev.type === 'nightEnded') {
        outcome = ev.outcome;
        scrapEarned = ev.scrapEarned;
        dataEarned = ev.dataEarned;
      }
    }
  }
  if (outcome === 'timeout') {
    // Stalemate (e.g. an unkillable boss): treat like a defeat payout.
    scrapEarned = Math.floor(sim.state.scrap * ECONOMY.defeatScrapFactor);
  }
  return {
    outcome,
    durationSec: ticks / TICK_RATE,
    scrapEarned,
    coresEarned,
    dataEarned,
    maxCombo: sim.state.maxCombo,
    citiesLeft: sim.state.cities.filter((c) => c.hp > 0).length,
  };
}

/** Simulate a whole run: night 1 until targetNight is cleared, the run gets
 *  stuck, or a generous attempt budget runs out. */
export function simulateRun(options: Partial<SimulateOptions> = {}): RunReport {
  const opts: SimulateOptions = { ...DEFAULT_OPTIONS, ...options };
  const run = newRun(opts.seed);
  const records: NightRecord[] = [];
  let attempt = 1;
  let failStreak = 0;
  let stuck = false;
  const attemptBudget = opts.targetNight * 4;

  while (run.bestNight < opts.targetNight && records.length < attemptBudget) {
    const thisNight = run.night;
    const thisAttempt = attempt;
    const result = playNight(run, opts, thisAttempt);

    // Dawn payout — mirrors resolveNight() in src/main.ts.
    run.cores += result.coresEarned;
    run.scrap += result.scrapEarned;
    run.scrap += dawnInterest(run.scrap, resolveStats(run.upgrades).scrapInterestRate);
    run.data += result.dataEarned;
    if (result.outcome === 'victory') {
      if (thisNight > run.bestNight) run.cores += firstClearCores(thisNight);
      run.bestNight = Math.max(run.bestNight, run.night);
      run.night += 1;
      attempt = 1;
      failStreak = 0;
    } else {
      attempt += 1;
      failStreak += 1;
    }

    const purchases = shop(run, opts.strategy);
    records.push({
      night: thisNight,
      attempt: thisAttempt,
      ...result,
      purchases,
      bank: { scrap: run.scrap, cores: run.cores, data: run.data },
    });

    if (failStreak >= opts.stuckLimit) {
      stuck = true;
      break;
    }
  }

  return { options: opts, records, run, cleared: run.bestNight >= opts.targetNight, stuck };
}
