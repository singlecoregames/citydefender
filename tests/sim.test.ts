import { describe, expect, it } from 'vitest';
import { CANNON, EXPLOSION, TICK_RATE, TURRET } from '../src/core/balance';
import { EXPLOSION_TOTAL_SECONDS } from '../src/core/explosion';
import { defaultNightConfig, Sim } from '../src/core/sim';
import { baseStats } from '../src/core/stats';
import type { Command } from '../src/core/types';

function run(sim: Sim, ticks: number, commandsAt: Map<number, Command[]> = new Map()): void {
  for (let i = 0; i < ticks; i++) {
    sim.step(commandsAt.get(sim.state.tick + 1) ?? []);
  }
}

describe('determinism', () => {
  it('two sims with the same seed and commands produce identical states', () => {
    const cmds = new Map<number, Command[]>([
      [30, [{ type: 'fire', x: 20, y: 60 }]],
      [90, [{ type: 'fire', x: -40, y: 70 }]],
      [200, [{ type: 'fire', x: 0, y: 50 }]],
    ]);
    const a = new Sim(12345);
    const b = new Sim(12345);
    run(a, 60 * 30, cmds);
    run(b, 60 * 30, cmds);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('different seeds diverge', () => {
    const a = new Sim(1);
    const b = new Sim(2);
    run(a, 60 * 10);
    run(b, 60 * 10);
    expect(JSON.stringify(a.state.enemies)).not.toBe(JSON.stringify(b.state.enemies));
  });
});

describe('cannon', () => {
  it('firing consumes ammo and spawns an interceptor', () => {
    const sim = new Sim(1);
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo - 1);
    expect(sim.state.interceptors).toHaveLength(1);
  });

  it('cannot fire with empty magazine', () => {
    const sim = new Sim(1);
    for (let i = 0; i < CANNON.maxAmmo; i++) {
      sim.step([{ type: 'fire', x: i * 5, y: 60 }]);
    }
    const events = sim.step([{ type: 'fire', x: 0, y: 80 }]);
    expect(events).toContainEqual({ type: 'fireDenied', reason: 'noAmmo' });
  });

  it('rejects targets too close to the cannon', () => {
    const sim = new Sim(1);
    const events = sim.step([{ type: 'fire', x: 0, y: 4 }]);
    expect(events).toContainEqual({ type: 'fireDenied', reason: 'tooClose' });
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo);
  });

  it('regenerates ammo over time', () => {
    const sim = new Sim(1);
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo - 1);
    run(sim, Math.ceil(CANNON.reloadSeconds * TICK_RATE) + 1);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo);
  });

  it('does not regenerate past max ammo', () => {
    const sim = new Sim(1);
    run(sim, TICK_RATE * 5);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo);
  });
});

describe('explosions', () => {
  it('interceptor detonates at its target point', () => {
    const sim = new Sim(1);
    sim.step([{ type: 'fire', x: 10, y: 50 }]);
    // Flight time = distance / speed; generous upper bound:
    run(sim, TICK_RATE * 3);
    // Explosion already spawned and possibly expired; check via events instead.
    const sim2 = new Sim(1);
    let detonated = false;
    sim2.step([{ type: 'fire', x: 10, y: 50 }]);
    for (let i = 0; i < TICK_RATE * 3 && !detonated; i++) {
      const events = sim2.step([]);
      for (const ev of events) {
        if (ev.type === 'detonation') {
          expect(ev.pos.x).toBeCloseTo(10, 0);
          expect(ev.pos.y).toBeCloseTo(50, 0);
          detonated = true;
        }
      }
    }
    expect(detonated).toBe(true);
  });

  it('kills an enemy inside the blast radius and awards scrap', () => {
    const sim = new Sim(1);
    // Inject an enemy directly for a controlled test.
    sim.state.enemies.push({
      id: 9999,
      kind: 'ballistic',
      pos: { x: 0, y: 50 },
      origin: { x: 0, y: 100 },
      vel: { x: 0, y: 0 },
      hp: 1,
      maxHp: 1,
      scrapReward: 5,
    });
    sim.state.explosions.push({
      id: 9998,
      pos: { x: 2, y: 50 },
      age: 0,
      maxRadius: EXPLOSION.maxRadius,
      damage: 1,
      hitEnemyIds: [],
    });
    const scrapBefore = sim.state.scrap;
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.enemies.find((e) => e.id === 9999)).toBeUndefined();
    expect(sim.state.scrap).toBe(scrapBefore + 5);
  });

  it('does not damage an enemy outside the blast radius', () => {
    const sim = new Sim(1);
    sim.state.enemies.push({
      id: 9999,
      kind: 'ballistic',
      pos: { x: 50, y: 50 },
      origin: { x: 50, y: 100 },
      vel: { x: 0, y: 0 },
      hp: 1,
      maxHp: 1,
      scrapReward: 5,
    });
    sim.state.explosions.push({
      id: 9998,
      pos: { x: 0, y: 50 },
      age: 0,
      maxRadius: EXPLOSION.maxRadius,
      damage: 1,
      hitEnemyIds: [],
    });
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.enemies.find((e) => e.id === 9999)).toBeDefined();
  });
});

describe('cities and night flow', () => {
  it('a ground impact near a city damages it', () => {
    const sim = new Sim(1);
    const city = sim.state.cities[0]!;
    sim.state.enemies.push({
      id: 9999,
      kind: 'ballistic',
      pos: { x: city.x, y: 0.5 },
      origin: { x: city.x, y: 100 },
      vel: { x: 0, y: -20 },
      hp: 1,
      maxHp: 1,
      scrapReward: 5,
    });
    run(sim, 10);
    expect(city.hp).toBe(0);
  });

  it('losing all cities ends the night in defeat with reduced scrap', () => {
    const sim = new Sim(1);
    sim.state.scrap = 100;
    for (const c of sim.state.cities) c.hp = 0;
    const events = sim.step([]);
    expect(sim.state.phase).toBe('ended');
    expect(sim.state.outcome).toBe('defeat');
    expect(sim.state.scrap).toBe(60);
    expect(events.some((e) => e.type === 'nightEnded')).toBe(true);
  });

  it('a full unplayed night ends in defeat eventually (cities get destroyed)', () => {
    const sim = new Sim(42);
    run(sim, TICK_RATE * 180);
    expect(sim.state.phase).toBe('ended');
  });

  it('stepping after the night ends is a no-op', () => {
    const sim = new Sim(1);
    for (const c of sim.state.cities) c.hp = 0;
    sim.step([]);
    const snapshot = JSON.stringify({ ...sim.state, events: [] });
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    expect(JSON.stringify({ ...sim.state, events: [] })).toBe(snapshot);
    expect(sim.state.events).toHaveLength(0);
  });
});

describe('automated turrets', () => {
  function configWith(stats: Partial<ReturnType<typeof baseStats>>) {
    const cfg = defaultNightConfig(1);
    cfg.stats = { ...cfg.stats, ...stats };
    return cfg;
  }

  it('deploys turretCount turrets at slot positions', () => {
    const sim = new Sim(1, configWith({ turretCount: 2 }));
    expect(sim.state.turrets).toHaveLength(2);
    expect(sim.state.turrets[0]!.x).toBe(TURRET.slotXs[0]);
  });

  it('a turret fires at and kills an in-range enemy', () => {
    const sim = new Sim(1, configWith({ turretCount: 1, turretDamage: 5 }));
    const turret = sim.state.turrets[0]!;
    sim.state.enemies.push({
      id: 9999,
      kind: 'ballistic',
      pos: { x: turret.x + 10, y: 30 },
      origin: { x: turret.x + 10, y: 100 },
      vel: { x: 0, y: 0 },
      hp: 3,
      maxHp: 3,
      scrapReward: 5,
    });
    const scrapBefore = sim.state.scrap;
    run(sim, TICK_RATE * 2);
    expect(sim.state.enemies.find((e) => e.id === 9999)).toBeUndefined();
    expect(sim.state.scrap).toBeGreaterThan(scrapBefore);
  });

  it('does not fire at enemies beyond turret range', () => {
    const sim = new Sim(1, configWith({ turretCount: 1, turretRange: 20 }));
    const turret = sim.state.turrets[0]!;
    sim.state.enemies.push({
      id: 8888,
      kind: 'ballistic',
      pos: { x: turret.x + 80, y: 90 },
      origin: { x: turret.x + 80, y: 100 },
      vel: { x: 0, y: 0 },
      hp: 1,
      maxHp: 1,
      scrapReward: 5,
    });
    run(sim, TICK_RATE);
    expect(sim.state.projectiles).toHaveLength(0);
    expect(sim.state.enemies.find((e) => e.id === 8888)).toBeDefined();
  });

  it('no turrets means no projectiles ever spawn', () => {
    const sim = new Sim(42);
    run(sim, TICK_RATE * 20);
    expect(sim.state.turrets).toHaveLength(0);
    expect(sim.state.projectiles).toHaveLength(0);
  });
});
