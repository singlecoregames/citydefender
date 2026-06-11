import { describe, expect, it } from 'vitest';
import { newRun } from '../src/core/run';
import { simulateRun } from '../tools/sim/meta';
import { shop } from '../tools/sim/strategy';

describe('balance simulator', () => {
  it('the scripted player clears night 1 with base stats', () => {
    const report = simulateRun({ seed: 1, targetNight: 1 });
    expect(report.cleared).toBe(true);
    expect(report.records[0]!.outcome).toBe('victory');
    expect(report.records[0]!.scrapEarned).toBeGreaterThan(0);
  });

  it('smart shopping follows the build order and saves for its next goal', () => {
    const run = newRun(1);
    run.scrap = 25; // enough for blast_radius (20), not the next milestone
    const bought = shop(run, 'smart');
    expect(bought).toEqual(['blast_radius']);
    expect(run.scrap).toBe(5); // saved, not spent on other cheap nodes
  });

  it('greedy shopping spends down to the cheapest unaffordable node', () => {
    const run = newRun(1);
    run.scrap = 50;
    const bought = shop(run, 'greedy');
    expect(bought.length).toBeGreaterThan(0);
    // Nothing affordable can remain after a greedy pass.
    const leftovers = shop(run, 'greedy');
    expect(leftovers).toEqual([]);
  });

  it('a short run progresses nights and mirrors the meta loop', () => {
    const report = simulateRun({ seed: 1, targetNight: 2 });
    expect(report.run.bestNight).toBeGreaterThanOrEqual(2);
    for (const rec of report.records) {
      expect(rec.durationSec).toBeGreaterThan(0);
      expect(rec.bank.scrap).toBeGreaterThanOrEqual(0);
    }
  });
});
