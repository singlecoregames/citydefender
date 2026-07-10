import { describe, expect, it } from 'vitest';
import { NIGHT_SCALING } from '../src/core/balance';
import { baseStats } from '../src/core/stats';
import { newRun } from '../src/core/run';
import { deserialize, serialize, SAVE_VERSION } from '../src/core/save';
import { getNode, isUnlocked, nextCost, resolveStats, TREE } from '../src/core/tree';
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
    for (let n = 1; n < 200; n += 7) {
      for (const w of generateNight(n)) {
        expect(w.spawnIntervalRange[0]).toBeGreaterThanOrEqual(NIGHT_SCALING.spawnIntervalFloor - 1e-9);
      }
    }
  });
});

describe('skill tree / stats', () => {
  it('base stats match an empty tree', () => {
    expect(resolveStats({})).toEqual(baseStats());
  });

  it('additive node (magazine) raises max ammo per level', () => {
    const base = baseStats().maxAmmo;
    expect(resolveStats({ magazine: 1 }).maxAmmo).toBe(base + 1);
    expect(resolveStats({ magazine: 3 }).maxAmmo).toBe(base + 3);
  });

  it('multiplicative node (blast radius) compounds per level', () => {
    const base = baseStats().explosionMaxRadius;
    expect(resolveStats({ blast_radius: 2 }).explosionMaxRadius).toBeCloseTo(base * 1.08 * 1.08, 5);
  });

  it('negative multiplier (autoloader) reduces reload time', () => {
    const base = baseStats().reloadSeconds;
    expect(resolveStats({ autoloader: 1 }).reloadSeconds).toBeCloseTo(base * 0.93, 5);
  });

  it('city nodes raise ground hp and split extra segments', () => {
    expect(resolveStats({ reinforced: 2 }).cityMaxHp).toBe(baseStats().cityMaxHp + 2);
    expect(resolveStats({ compact: 1 }).cityMaxHp).toBe(baseStats().cityMaxHp + 1);
    expect(resolveStats({ districts: 2 }).cityCount).toBe(baseStats().cityCount + 2);
  });

  it('cost grows with level and maxes out', () => {
    const node = getNode('blast_radius')!;
    expect(nextCost(node, 1)!).toBeGreaterThan(nextCost(node, 0)!);
    expect(nextCost(node, node.maxLevel)).toBeNull();
  });

  it('every node effect targets a real stat key', () => {
    const keys = new Set(Object.keys(baseStats()));
    for (const node of TREE) {
      for (const eff of node.effects) expect(keys.has(eff.stat)).toBe(true);
    }
  });

  it('every prerequisite id refers to an existing node', () => {
    const ids = new Set(TREE.map((n) => n.id));
    for (const node of TREE) {
      for (const req of node.requires) expect(ids.has(req)).toBe(true);
    }
  });

  it('node ids are unique', () => {
    const ids = TREE.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('locked node unlocks once its prerequisite has a level', () => {
    const warhead = getNode('warhead')!;
    expect(isUnlocked(warhead, {})).toBe(false);
    // warhead requires wide_blast + fast_intercept
    expect(isUnlocked(warhead, { wide_blast: 1, fast_intercept: 1 })).toBe(true);
  });

  it('root nodes (no prerequisites) are always unlocked', () => {
    for (const node of TREE) {
      if (node.requires.length === 0) expect(isUnlocked(node, {})).toBe(true);
    }
  });

  it('no two nodes share a grid position', () => {
    const seen = new Set<string>();
    for (const node of TREE) {
      const key = `${node.col},${node.row}`;
      expect(seen.has(key), `position clash at ${key} (${node.id})`).toBe(false);
      seen.add(key);
    }
  });

  it('phase-1 economy/city/tech nodes resolve their stats', () => {
    expect(resolveStats({ midas_protocol: 1 }).scrapMul).toBeCloseTo(1.15, 5);
    expect(resolveStats({ war_insurance: 2 }).cityHitScrap).toBe(20);
    expect(resolveStats({ wave_dividend: 1 }).waveClearScrap).toBe(5);
    expect(resolveStats({ chain_bounty: 2 }).multiKillScrap).toBe(4);
    expect(resolveStats({ flux_capacitor: 1 }).abilityCooldownMul).toBeCloseTo(0.92, 5);
    expect(
      resolveStats({ flux_capacitor: 1, singularity_core: 1 }).abilityCooldownMul,
    ).toBeCloseTo(0.92 * 0.85, 5);
  });

  it('phase-3 spec nodes resolve their stats', () => {
    expect(resolveStats({ doppler_tracking: 1 }).dopplerTracking).toBe(1);
    expect(resolveStats({ wide_spectrum: 2 }).jammerRadiusMul).toBeCloseTo(1.2 * 1.2, 5);
  });

  it('combo/overcharge/data nodes resolve their stats', () => {
    expect(resolveStats({ overcharge_shot: 2 }).overchargeRate).toBeCloseTo(0.08, 5);
    expect(resolveStats({ combo_memory: 3 }).comboRetention).toBeCloseTo(0.75, 5);
    expect(resolveStats({ threat_analysis: 1 }).threatTargeting).toBe(1);
    expect(resolveStats({ neural_lead: 2 }).turretSpreadMul).toBeCloseTo(0.85 * 0.85, 5);
  });

  it('data-priced nodes are marked with the data currency', () => {
    for (const id of ['combo_memory', 'threat_analysis', 'neural_lead']) {
      expect(getNode(id)!.currency).toBe('data');
    }
  });

});

describe('save / load', () => {
  it('round-trips a run', () => {
    const run = newRun(42);
    run.night = 5;
    run.scrap = 123;
    run.upgrades = { core: 1, magazine: 2 };
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
    // The command core is always kept so branch roots stay unlocked.
    expect(restored.upgrades).toEqual({ core: 1 });
    expect(restored.bestNight).toBe(0);
    // Saves from before the Data currency default to an empty bank.
    expect(restored.data).toBe(0);
  });

  it('migrates Time Dilation levels onto Free Fire', () => {
    const restored = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        run: { night: 12, upgrades: { core: 1, ability_slowmo: 3 } },
      }),
    );
    expect(restored.upgrades['ability_freefire']).toBe(3);
    expect(restored.upgrades['ability_slowmo']).toBeUndefined();
  });
});
