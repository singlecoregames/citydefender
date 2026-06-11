import { describe, expect, it } from 'vitest';
import { baseStats } from '../src/core/stats';
import { newRun } from '../src/core/run';
import { deserialize, serialize, SAVE_VERSION } from '../src/core/save';
import { nextCost, resolveStats, UPGRADES, getUpgrade } from '../src/core/upgrades';
import { generateNight, waveCountForNight } from '../src/core/waves';

describe('waves', () => {
  it('later nights have at least as many waves', () => {
    for (let n = 1; n < 50; n++) {
      expect(waveCountForNight(n + 1)).toBeGreaterThanOrEqual(waveCountForNight(n));
    }
  });

  it('enemy strength scales up with the night number', () => {
    const n1 = generateNight(1)[0]!;
    const n10 = generateNight(10)[0]!;
    expect(n10.hpScale).toBeGreaterThan(n1.hpScale);
    expect(n10.count).toBeGreaterThan(n1.count);
    expect(n10.rewardScale).toBeGreaterThan(n1.rewardScale);
  });

  it('is deterministic for a given night', () => {
    expect(JSON.stringify(generateNight(7))).toBe(JSON.stringify(generateNight(7)));
  });

  it('spawn intervals never go below the floor', () => {
    for (let n = 1; n < 60; n++) {
      for (const w of generateNight(n)) {
        expect(w.spawnIntervalRange[0]).toBeGreaterThanOrEqual(0.31);
      }
    }
  });
});

describe('upgrades / stats', () => {
  it('base stats match an empty upgrade set', () => {
    expect(resolveStats({})).toEqual(baseStats());
  });

  it('additive upgrade (magazine) raises max ammo per level', () => {
    const base = baseStats().maxAmmo;
    expect(resolveStats({ magazine: 1 }).maxAmmo).toBe(base + 1);
    expect(resolveStats({ magazine: 3 }).maxAmmo).toBe(base + 3);
  });

  it('multiplicative upgrade (blast radius) compounds per level', () => {
    const base = baseStats().explosionMaxRadius;
    expect(resolveStats({ blast_radius: 2 }).explosionMaxRadius).toBeCloseTo(base * 1.08 * 1.08, 5);
  });

  it('negative multiplier (autoloader) reduces reload time', () => {
    const base = baseStats().reloadSeconds;
    expect(resolveStats({ autoloader: 1 }).reloadSeconds).toBeCloseTo(base * 0.93, 5);
  });

  it('cost grows with level and maxes out', () => {
    const def = getUpgrade('blast_radius')!;
    const c0 = nextCost(def, 0)!;
    const c1 = nextCost(def, 1)!;
    expect(c1).toBeGreaterThan(c0);
    expect(nextCost(def, def.maxLevel)).toBeNull();
  });

  it('every upgrade effect targets a real stat key', () => {
    const keys = new Set(Object.keys(baseStats()));
    for (const def of UPGRADES) {
      for (const eff of def.effects) expect(keys.has(eff.stat)).toBe(true);
    }
  });
});

describe('save / load', () => {
  it('round-trips a run', () => {
    const run = newRun(42);
    run.night = 5;
    run.scrap = 123;
    run.upgrades = { magazine: 2 };
    const restored = deserialize(serialize(run));
    expect(restored).toEqual(run);
  });

  it('returns a fresh run for null / corrupt data', () => {
    expect(deserialize(null).night).toBe(1);
    expect(deserialize('not json{').night).toBe(1);
    expect(deserialize('{"version":1}').night).toBe(1);
  });

  it('fills defaults for partial saves', () => {
    const restored = deserialize(JSON.stringify({ version: SAVE_VERSION, run: { night: 3, scrap: 10 } }));
    expect(restored.night).toBe(3);
    expect(restored.scrap).toBe(10);
    expect(restored.upgrades).toEqual({});
    expect(restored.bestNight).toBe(0);
  });
});
