import { describe, expect, it } from 'vitest';
import { FIELD, NIGHT_SCALING } from '../src/core/balance';
import { baseStats } from '../src/core/stats';
import { newRun } from '../src/core/run';
import { deserialize, serialize, SAVE_VERSION } from '../src/core/save';
import {
  getNode,
  isUnlocked,
  nextPrice,
  reqId,
  reqLevel,
  resolveStats,
  TREE,
  type TreeLevels,
} from '../src/core/tree';
import { generateNight, waveCountForNight } from '../src/core/waves';

describe('waves', () => {
  it('later nights have at least as many waves', () => {
    for (let n = 1; n < 50; n++) {
      expect(waveCountForNight(n + 1)).toBeGreaterThanOrEqual(waveCountForNight(n));
    }
  });

  it('enemy strength scales up with the night number', () => {
    const n1 = generateNight(1)[0]!;
    // N11, not N10: boss nights deliberately thin their regular waves.
    const n11 = generateNight(11)[0]!;
    expect(n11.hpScale).toBeGreaterThan(n1.hpScale);
    expect(n11.count).toBeGreaterThan(n1.count);
    expect(n11.rewardScale).toBeGreaterThan(n1.rewardScale);
  });

  it('volume pity thins a retried night, bounded by its cap', () => {
    const fresh = generateNight(15)[0]!;
    const retried = generateNight(15, 2)[0]!;
    const floored = generateNight(15, 99)[0]!;
    expect(retried.count).toBeLessThan(fresh.count);
    expect(floored.count).toBeGreaterThanOrEqual(Math.floor(fresh.count * 0.7));
    // Strength is untouched — pity trims volume only.
    expect(retried.hpScale).toBe(fresh.hpScale);
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

  it('additive node (drum magazine) raises max ammo per level', () => {
    const base = baseStats().maxAmmo;
    expect(resolveStats({ drum_magazine: 1 }).maxAmmo).toBe(base + 1);
    expect(resolveStats({ drum_magazine: 3 }).maxAmmo).toBe(base + 3);
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
    expect(nextPrice(node, 1)!.amount).toBeGreaterThan(nextPrice(node, 0)!.amount);
    expect(nextPrice(node, node.maxLevel)).toBeNull();
  });

  it('every node effect targets a real stat key', () => {
    const keys = new Set(Object.keys(baseStats()));
    for (const node of TREE) {
      for (const eff of node.effects) expect(keys.has(eff.stat)).toBe(true);
    }
  });

  it('every prerequisite id refers to an existing node, within its level cap', () => {
    const byId = new Map(TREE.map((n) => [n.id, n]));
    for (const node of TREE) {
      for (const req of node.requires) {
        const target = byId.get(reqId(req));
        expect(target, `${node.id} requires missing node ${reqId(req)}`).toBeDefined();
        // A graduation gate above the prereq's max level could never open.
        expect(reqLevel(req), `${node.id} gate exceeds ${reqId(req)} max`).toBeLessThanOrEqual(
          target!.maxLevel,
        );
      }
    }
  });

  it('node ids are unique', () => {
    const ids = TREE.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('graduation gates need the prerequisite at its required LEVEL', () => {
    const warhead = getNode('warhead')!;
    expect(isUnlocked(warhead, {})).toBe(false);
    // warhead requires wide_blast at level 2 — level 1 is not enough.
    expect(isUnlocked(warhead, { wide_blast: 1 })).toBe(false);
    expect(isUnlocked(warhead, { wide_blast: 2 })).toBe(true);
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

  it('field / hold-fire nodes resolve their stats', () => {
    expect(resolveStats({ static_charge: 2 }).fieldDamage).toBeCloseTo(FIELD.damage + 1, 5);
    expect(resolveStats({ wide_field: 5 }).fieldRadius).toBeCloseTo(FIELD.radius * 1.1 ** 5, 5);
    expect(resolveStats({ pulse_cycle: 5 }).fieldPulseSeconds).toBeCloseTo(
      FIELD.pulseSeconds * 0.93 ** 5,
      5,
    );
    expect(resolveStats({ static_link: 5 }).fieldDpsRate).toBeCloseTo(0.2, 5);
    expect(resolveStats({ field_coils: 1 }).fieldRadius).toBeCloseTo(FIELD.radius * 1.12, 5);
    expect(resolveStats({ field_coils: 1 }).fieldPulseSeconds).toBeCloseTo(
      FIELD.pulseSeconds * 0.94,
      5,
    );
  });

  it('special nodes unlock with exactly one boss token, then upgrade in scrap', () => {
    const specials = TREE.filter((n) => n.unlockCores !== undefined);
    // 11 unlocks vs the campaign's 12 boss kills: every token is a choice.
    expect(specials).toHaveLength(11);
    for (const node of specials) {
      expect(node.unlockCores).toBe(1);
      expect(nextPrice(node, 0)).toEqual({ currency: 'cores', amount: 1 });
      if (node.maxLevel > 1) expect(nextPrice(node, 1)!.currency).toBe('scrap');
    }
  });

});

describe('tree structure invariants (the Nodebuster/Shelldiver rules)', () => {
  /** Graph depth from the core: 1 + the shallowest prerequisite's depth. */
  function depths(): Map<string, number> {
    const d = new Map<string, number>([['core', 0]]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of TREE) {
        if (d.has(n.id) || n.requires.length === 0) continue;
        const parents = n.requires.map((r) => d.get(reqId(r)));
        if (parents.every((p) => p !== undefined)) {
          d.set(n.id, Math.min(...(parents as number[])) + 1);
          changed = true;
        }
      }
    }
    return d;
  }

  it('every node is reachable from the core', () => {
    const d = depths();
    for (const node of TREE) expect(d.has(node.id), `${node.id} unreachable`).toBe(true);
  });

  it('prices step hard with depth: ring d min ≥ 1.5 × ring d-1 max', () => {
    // Tier-1 scrap content only — special (◆) unlocks price their later
    // levels off-band by design, and tier 2-4 ride the world income steps.
    const d = depths();
    const bands = new Map<number, { min: number; max: number }>();
    for (const node of TREE) {
      if (node.id === 'core' || node.unlockCores || (node.tier ?? 1) > 1) continue;
      const price = nextPrice(node, 0)!;
      if (price.currency !== 'scrap') continue;
      const ring = d.get(node.id)!;
      const band = bands.get(ring) ?? { min: Infinity, max: 0 };
      band.min = Math.min(band.min, price.amount);
      band.max = Math.max(band.max, price.amount);
      bands.set(ring, band);
    }
    const rings = [...bands.keys()].sort((a, b) => a - b);
    for (let i = 1; i < rings.length; i++) {
      const prev = bands.get(rings[i - 1]!)!;
      const cur = bands.get(rings[i]!)!;
      expect(
        cur.min,
        `ring ${rings[i]} min ${cur.min} undercuts ring ${rings[i - 1]} max ${prev.max}`,
      ).toBeGreaterThanOrEqual(prev.max * 1.5);
    }
  });

  it('the open frontier stays small under greedy play', () => {
    // Greedy cheapest-first through the world-1 tree: at every step, the
    // nodes a player actually weighs (unlocked, scrap-priced, within 3× of
    // the cheapest option) must stay a handful — the whole point of the
    // graduation gates and serial side-chains. UNSEEN nodes are the real
    // reading burden, so they get the tighter cap; next levels of nodes the
    // player already owns are cheap re-buys and get a looser one. (The old
    // 5-way fan peaked at 24 simultaneous choices.)
    const levels: TreeLevels = { core: 1 };
    const weighedCounts: number[] = [];
    for (let step = 0; step < 90; step++) {
      const open = TREE.filter((n) => n.id !== 'core' && isUnlocked(n, levels, 1))
        .map((n) => ({ n, p: nextPrice(n, levels[n.id] ?? 0) }))
        .filter((x) => x.p !== null && x.p.currency === 'scrap');
      if (open.length === 0) break;
      const cheapest = Math.min(...open.map((x) => x.p!.amount));
      // "Weighed" = options in the same price class as the cheapest buy;
      // "fresh" = the never-bought ones among them (the real reading burden).
      const weighed = open.filter((x) => x.p!.amount <= cheapest * 2);
      const fresh = weighed.filter((x) => (levels[x.n.id] ?? 0) === 0);
      expect(
        fresh.length,
        `step ${step}: ${fresh.map((x) => x.n.id).join(',')}`,
      ).toBeLessThanOrEqual(5);
      weighedCounts.push(weighed.length);
      // A player takes new content when it is in reach, else levels the
      // cheapest owned node — pure cheapest-first would hoard fresh nodes
      // it never intends to buy and measure its own artifact.
      const sorted = open.sort((a, b) => a.p!.amount - b.p!.amount);
      const pick =
        fresh.length > 0 ? fresh.sort((a, b) => a.p!.amount - b.p!.amount)[0]! : sorted[0]!;
      levels[pick.n.id] = (levels[pick.n.id] ?? 0) + 1;
    }
    const mean = weighedCounts.reduce((a, b) => a + b, 0) / weighedCounts.length;
    expect(mean, `mean weighed choices ${mean.toFixed(1)}`).toBeLessThanOrEqual(15);
  });
});

describe('save / load', () => {
  it('round-trips a run', () => {
    const run = newRun(42);
    run.night = 5;
    run.scrap = 123;
    run.upgrades = { core: 1, blast_radius: 2 };
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
  });

  it('merges Magazine levels into Drum Magazine, capped at its max', () => {
    const restored = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        run: { night: 9, upgrades: { core: 1, magazine: 2, drum_magazine: 2 } },
      }),
    );
    expect(restored.upgrades['drum_magazine']).toBe(3); // 2+2 capped at max 3
    expect(restored.upgrades['magazine']).toBeUndefined();
  });

  it('folds Rapid Trigger levels into Autoloader, capped at its max', () => {
    const restored = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        run: { night: 20, upgrades: { core: 1, rapid_trigger: 3, autoloader: 4 } },
      }),
    );
    expect(restored.upgrades['autoloader']).toBe(5); // 4+3 capped at max 5
    expect(restored.upgrades['rapid_trigger']).toBeUndefined();
  });

  it('migrates Heat Sink levels onto Field Coils', () => {
    const restored = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        run: { night: 12, upgrades: { core: 1, heat_sink: 2 } },
      }),
    );
    expect(restored.upgrades['field_coils']).toBe(2);
    expect(restored.upgrades['heat_sink']).toBeUndefined();
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
