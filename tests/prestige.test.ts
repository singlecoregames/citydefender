import { describe, expect, it } from 'vitest';
import { PRESTIGE, prestigePoints, TICK_RATE } from '../src/core/balance';
import { PRESTIGE_UPGRADES, prestigeNextCost } from '../src/core/prestige';
import { doPrestige, newRun } from '../src/core/run';
import { deserialize, serialize, SAVE_VERSION } from '../src/core/save';
import { defaultNightConfig, Sim } from '../src/core/sim';
import { generateNight } from '../src/core/waves';

describe('prestige points & reset', () => {
  it('pays 1✦ per 10 nights reached, nothing below the unlock night', () => {
    expect(prestigePoints(PRESTIGE.minNight - 1)).toBe(0);
    expect(prestigePoints(30)).toBe(3);
    expect(prestigePoints(150)).toBe(15);
    // The N30/60/90/120/150 wall cadence banks ~the whole upgrade catalogue.
    const walls = [30, 60, 90, 120, 150].reduce((a, n) => a + prestigePoints(n), 0);
    const catalogue = PRESTIGE_UPGRADES.reduce((a, u) => {
      let sum = 0;
      for (let l = 0; l < u.maxLevel; l++) sum += prestigeNextCost(u, l)!;
      return a + sum;
    }, 0);
    expect(Math.abs(walls - catalogue)).toBeLessThanOrEqual(3);
  });

  it('doPrestige banks points and resets everything except prestige state', () => {
    const run = newRun(7);
    run.night = 26;
    run.bestNight = 25;
    run.scrap = 5000;
    run.cores = 4;
    run.data = 9;
    run.upgrades = { core: 1, turret_gatling: 3 };
    run.prestigeUpgrades = { drone_escort: 1 };
    run.pp = 2;
    const next = doPrestige(run);
    expect(next.prestige).toBe(1);
    expect(next.pp).toBe(2 + prestigePoints(25));
    expect(next.prestigeUpgrades).toEqual({ drone_escort: 1 });
    expect(next.night).toBe(1);
    expect(next.bestNight).toBe(0);
    expect(next.cores).toBe(0);
    expect(next.data).toBe(0);
    expect(next.upgrades).toEqual({ core: 1 });
  });

  it('Head Start seeds the post-prestige run with scrap', () => {
    const run = newRun(7);
    run.bestNight = 20;
    run.prestigeUpgrades = { head_start: 2 };
    expect(doPrestige(run).scrap).toBe(500);
  });

  it('saves round-trip prestige state and default it for old saves', () => {
    const run = newRun(3);
    run.prestige = 2;
    run.pp = 5;
    run.prestigeUpgrades = { mirv_warhead: 1 };
    expect(deserialize(serialize(run))).toEqual(run);
    const old = deserialize(JSON.stringify({ version: SAVE_VERSION, run: { night: 4 } }));
    expect(old.prestige).toBe(0);
    expect(old.pp).toBe(0);
    expect(old.prestigeUpgrades).toEqual({});
  });
});

describe('late-night enemy volume', () => {
  it('the per-wave cap climbs with the night into space-war floods', () => {
    const sum = (w: ReturnType<typeof generateNight>) => w.reduce((a, x) => a + x.count, 0);
    expect(sum(generateNight(200))).toBeGreaterThan(sum(generateNight(60)) * 2.5);
    // Wave COUNT stays capped so late nights stay minutes long.
    expect(generateNight(200).length).toBeLessThanOrEqual(10);
  });
});

describe('prestige upgrades in the sim', () => {
  function inject(sim: Sim, id: number, pos: { x: number; y: number }, hp = 1) {
    sim.state.enemies.push({
      id, kind: 'ballistic', pos: { ...pos }, origin: { x: pos.x, y: 100 },
      vel: { x: 0, y: 0 }, hp, maxHp: hp, scrapReward: 5,
    });
  }

  it('escort drones orbit and shoot at enemies in range', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.drones = 2;
    const sim = new Sim(1, cfg);
    inject(sim, 1, { x: 0, y: 45 }, 99);
    sim.step([]);
    expect(sim.state.drones).toHaveLength(2);
    const before = { ...sim.state.drones[0]! };
    run(sim, TICK_RATE * 2); // orbiting and shooting
    expect(sim.state.drones[0]!.x).not.toBeCloseTo(before.x, 3);
    // Their gatling-class rounds have landed on the target by now.
    expect(sim.state.enemies[0]!.hp).toBeLessThan(99);
  });

  it('MIRV splits an interceptor blast into submunitions', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.mirvLevel = 1;
    const sim = new Sim(1, cfg);
    inject(sim, 1, { x: 0, y: 110 }); // keeps the night alive
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    run(sim, TICK_RATE * 2); // flight + detonation
    // Main blast + 2 submunitions existed at some point; check via history:
    // explosions may have expired, so re-run and sample right at detonation.
    const sim2 = new Sim(1, cfg);
    inject(sim2, 1, { x: 0, y: 110 });
    sim2.step([{ type: 'fire', x: 0, y: 60 }]);
    let maxConcurrent = 0;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      sim2.step([]);
      maxConcurrent = Math.max(maxConcurrent, sim2.state.explosions.length);
    }
    expect(maxConcurrent).toBe(3);
  });

  function run(sim: Sim, ticks: number): void {
    for (let i = 0; i < ticks; i++) sim.step([]);
  }
});
