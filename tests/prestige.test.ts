import { describe, expect, it } from 'vitest';
import { nightInWorld, TICK_RATE, WORLDS, worldOf } from '../src/core/balance';
import { deserialize, SAVE_VERSION } from '../src/core/save';
import { defaultNightConfig, Sim } from '../src/core/sim';
import { getNode, isUnlocked, nodeTier, resolveStats, TREE } from '../src/core/tree';
import { generateNight } from '../src/core/waves';

describe('worlds & tiers', () => {
  it('120 nights split into 4 worlds of 30', () => {
    expect(worldOf(1)).toBe(1);
    expect(worldOf(30)).toBe(1);
    expect(worldOf(31)).toBe(2);
    expect(worldOf(90)).toBe(3);
    expect(worldOf(91)).toBe(4);
    expect(worldOf(120)).toBe(4);
    expect(worldOf(999)).toBe(WORLDS.count); // clamped past the campaign
    expect(nightInWorld(31)).toBe(1);
    expect(nightInWorld(120)).toBe(30);
  });

  it('higher-tier nodes stay locked until their world', () => {
    const arsenal = getNode('arsenal_core')!;
    const twin = getNode('gatling_twin')!;
    const levels = { core: 1, turret_power: 1, gatling_belt: 1 };
    expect(nodeTier(arsenal)).toBe(2);
    expect(nodeTier(twin)).toBe(3);
    expect(isUnlocked(arsenal, levels, 1)).toBe(false); // world 1: tier 2 locked
    expect(isUnlocked(arsenal, levels, 2)).toBe(true);
    expect(isUnlocked(twin, levels, 2)).toBe(false); // world 2: tier 3 locked
    expect(isUnlocked(twin, levels, 3)).toBe(true);
    expect(isUnlocked(arsenal, levels)).toBe(true); // tier-agnostic default
  });

  it('every tier is represented in the tree', () => {
    const tiers = new Set(TREE.map((n) => nodeTier(n)));
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(2)).toBe(true);
    expect(tiers.has(3)).toBe(true);
    expect(tiers.has(4)).toBe(true);
  });
});

describe('tier-2 upgrades (former prestige) resolve through the tree', () => {
  it('arsenal core multiplies both damage stats', () => {
    const s = resolveStats({ arsenal_core: 2 });
    expect(s.turretDamageMul).toBeCloseTo(2.25, 5);
    expect(s.explosionDamage).toBeCloseTo(2.25, 5);
  });

  it('drone escort / MIRV levels land in derived stats', () => {
    expect(resolveStats({ drone_escort: 2 }).droneCount).toBe(2);
    expect(resolveStats({ mirv_warhead: 1 }).mirvLevel).toBe(1);
  });

  it('legacy reset-prestige saves migrate their upgrades into the tree', () => {
    const restored = deserialize(
      JSON.stringify({
        version: SAVE_VERSION,
        run: {
          night: 12,
          upgrades: { core: 1 },
          prestigeUpgrades: { arsenal_core: 3, drone_escort: 2, head_start: 2 },
        },
      }),
    );
    expect(restored.upgrades['arsenal_core']).toBe(3);
    expect(restored.upgrades['drone_escort']).toBe(2);
    expect(restored.upgrades['head_start']).toBeUndefined(); // no heir
    expect((restored as { prestigeUpgrades?: unknown }).prestigeUpgrades).toBeUndefined();
  });
});

describe('drones & MIRV in the sim', () => {
  function inject(sim: Sim, id: number, pos: { x: number; y: number }, hp = 1) {
    sim.state.enemies.push({
      id, kind: 'ballistic', pos: { ...pos }, origin: { x: pos.x, y: 100 },
      vel: { x: 0, y: 0 }, hp, maxHp: hp, scrapReward: 5,
    });
  }

  function run(sim: Sim, ticks: number): void {
    for (let i = 0; i < ticks; i++) sim.step([]);
  }

  it('escort drones orbit and shoot at enemies in range', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.stats = { ...cfg.stats, droneCount: 2 };
    const sim = new Sim(1, cfg);
    inject(sim, 1, { x: 0, y: 45 }, 99);
    sim.step([]);
    expect(sim.state.drones).toHaveLength(2);
    const before = { ...sim.state.drones[0]! };
    run(sim, TICK_RATE * 2);
    expect(sim.state.drones[0]!.x).not.toBeCloseTo(before.x, 3);
    expect(sim.state.enemies[0]!.hp).toBeLessThan(99);
  });

  it('MIRV splits an interceptor blast into submunitions', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.stats = { ...cfg.stats, mirvLevel: 1 };
    const sim = new Sim(1, cfg);
    inject(sim, 1, { x: 0, y: 110 }); // keeps the night alive
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    let maxConcurrent = 0;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      sim.step([]);
      maxConcurrent = Math.max(maxConcurrent, sim.state.explosions.length);
    }
    expect(maxConcurrent).toBe(3);
  });
});

describe('tier-4 spectacle upgrades', () => {
  function inject(sim: Sim, id: number, pos: { x: number; y: number }, vel = { x: 0, y: 0 }, hp = 1) {
    sim.state.enemies.push({
      id, kind: 'ballistic', pos: { ...pos }, origin: { x: pos.x, y: 100 },
      vel: { ...vel }, hp, maxHp: hp, scrapReward: 5,
    });
  }

  it('Orbital Lance strikes the densest column on its timer', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.stats = { ...cfg.stats, lanceLevel: 1 };
    const sim = new Sim(1, cfg);
    inject(sim, 1, { x: -50, y: 60 }, { x: 0, y: 0 }, 99); // lone decoy column
    inject(sim, 2, { x: 40, y: 55 }, { x: 0, y: 0 }, 99); // dense column...
    inject(sim, 3, { x: 44, y: 70 }, { x: 0, y: 0 }, 99);
    inject(sim, 4, { x: 38, y: 80 }, { x: 0, y: 0 }, 99);
    let lanceBeams = 0;
    for (let i = 0; i < TICK_RATE * 12; i++) {
      for (const ev of sim.step([])) if (ev.type === 'beam' && ev.kind === 'lance') lanceBeams++;
    }
    expect(lanceBeams).toBeGreaterThanOrEqual(1);
    // The dense column took lance damage; the far decoy did not.
    expect(sim.state.enemies.find((e) => e.id === 2)!.hp).toBeLessThan(99);
    expect(sim.state.enemies.find((e) => e.id === 1)!.hp).toBe(99);
  });

  it('Aegis Dome vaporises non-boss enemies at its shell, one charge each', () => {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.stats = { ...cfg.stats, aegisCharges: 1 };
    const sim = new Sim(1, cfg);
    expect(sim.state.aegisCharges).toBe(1);
    inject(sim, 1, { x: 0, y: 60 }, { x: 0, y: -30 });
    inject(sim, 2, { x: 2, y: 90 }, { x: 0, y: -30 });
    let absorbed = 0;
    let impacts = 0;
    for (let i = 0; i < TICK_RATE * 4; i++) {
      for (const ev of sim.step([])) {
        if (ev.type === 'aegisAbsorbed') absorbed++;
        if (ev.type === 'groundImpact') impacts++;
      }
    }
    expect(absorbed).toBe(1); // first enemy spent the only charge...
    expect(sim.state.aegisCharges).toBe(0);
    expect(impacts).toBe(1); // ...the second got through
  });
});

describe('late-night enemy volume', () => {
  it('the per-wave cap climbs with the night into space-war floods', () => {
    const sum = (w: ReturnType<typeof generateNight>) => w.reduce((a, x) => a + x.count, 0);
    expect(sum(generateNight(120))).toBeGreaterThan(sum(generateNight(40)) * 2);
    expect(generateNight(120).length).toBeLessThanOrEqual(10);
  });
});
