import { describe, expect, it } from 'vitest';
import { interceptDirection, rotate } from '../src/core/aiming';
import { CANNON, EXPLOSION, TICK_RATE, TURRETS } from '../src/core/balance';
import { EXPLOSION_TOTAL_SECONDS } from '../src/core/explosion';
import { defaultNightConfig, Sim } from '../src/core/sim';
import { baseStats } from '../src/core/stats';
import { enemyPool } from '../src/core/waves';
import type { Command, EnemyKind, TurretKind } from '../src/core/types';

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
  function configWithTurrets(
    turrets: { kind: TurretKind; level: number }[],
    stats: Partial<ReturnType<typeof baseStats>> = {},
  ) {
    const cfg = defaultNightConfig(1);
    cfg.turrets = turrets;
    cfg.stats = { ...cfg.stats, ...stats };
    cfg.waves = []; // no natural spawns in these controlled tests
    return cfg;
  }

  function spawnEnemy(
    sim: Sim,
    id: number,
    pos: { x: number; y: number },
    vel = { x: 0, y: 0 },
    hp = 1,
  ) {
    sim.state.enemies.push({
      id,
      kind: 'ballistic',
      pos: { ...pos },
      origin: { x: pos.x, y: 100 },
      vel: { ...vel },
      hp,
      maxHp: hp,
      scrapReward: 5,
    });
  }

  it('deploys each owned kind at its predetermined position', () => {
    const sim = new Sim(1, configWithTurrets([
      { kind: 'gatling', level: 1 },
      { kind: 'tesla', level: 2 },
    ]));
    expect(sim.state.turrets).toHaveLength(2);
    expect(sim.state.turrets[0]!.x).toBe(TURRETS.gatling.x);
    expect(sim.state.turrets[1]!.x).toBe(TURRETS.tesla.x);
    expect(sim.state.turrets[1]!.level).toBe(2);
  });

  it('a gatling fires at and kills an in-range enemy', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'gatling', level: 1 }], { turretDamageMul: 5 }));
    const turret = sim.state.turrets[0]!;
    spawnEnemy(sim, 9999, { x: turret.x + 10, y: 30 }, { x: 0, y: 0 }, 3);
    const scrapBefore = sim.state.scrap;
    run(sim, TICK_RATE * 3);
    expect(sim.state.enemies.find((e) => e.id === 9999)).toBeUndefined();
    expect(sim.state.scrap).toBeGreaterThan(scrapBefore);
  });

  it('does not fire at enemies beyond turret range', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'gatling', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    spawnEnemy(sim, 8888, { x: turret.x + 80, y: 90 });
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

  it('hits a moving enemy by leading it (across many seeds)', () => {
    // A fast-falling enemy crossing the turret's range: direct aim would
    // trail behind it; lead aim should land most shots despite the spread.
    let kills = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim(seed, configWithTurrets([{ kind: 'gatling', level: 1 }]));
      const turret = sim.state.turrets[0]!;
      spawnEnemy(sim, 7777, { x: turret.x - 25, y: 55 }, { x: 10, y: -14 });
      run(sim, TICK_RATE * 4);
      if (!sim.state.enemies.some((e) => e.id === 7777)) kills++;
    }
    expect(kills).toBeGreaterThanOrEqual(7);
  });

  it('laser never misses an in-range enemy and emits a beam', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'laser', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    spawnEnemy(sim, 6666, { x: turret.x + 15, y: 25 }, { x: 8, y: -8 });
    let sawBeam = false;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      for (const ev of sim.step([])) {
        if (ev.type === 'beam' && ev.kind === 'laser') sawBeam = true;
      }
    }
    expect(sawBeam).toBe(true);
    expect(sim.state.enemies.find((e) => e.id === 6666)).toBeUndefined();
  });

  it('flak shell bursts into an explosion that damages a cluster', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'flak', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    // A tight, stationary cluster inside flak range.
    spawnEnemy(sim, 5551, { x: turret.x + 5, y: 40 });
    spawnEnemy(sim, 5552, { x: turret.x + 8, y: 41 });
    spawnEnemy(sim, 5553, { x: turret.x + 6, y: 38 });
    run(sim, TICK_RATE * 6);
    const survivors = sim.state.enemies.filter((e) => e.id >= 5551 && e.id <= 5553);
    expect(survivors.length).toBeLessThan(3); // at least part of the cluster died
  });

  it('railgun pierces multiple enemies along one line', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'railgun', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    // Three stationary enemies stacked along the vertical above the railgun.
    spawnEnemy(sim, 4441, { x: turret.x, y: 30 });
    spawnEnemy(sim, 4442, { x: turret.x, y: 50 });
    spawnEnemy(sim, 4443, { x: turret.x, y: 70 });
    run(sim, TICK_RATE);
    const survivors = sim.state.enemies.filter((e) => e.id >= 4441 && e.id <= 4443);
    expect(survivors).toHaveLength(0); // one shot took the whole column
  });

  it('tesla chains to nearby enemies but not distant ones', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'tesla', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    spawnEnemy(sim, 3331, { x: turret.x + 5, y: 20 }); // in range
    spawnEnemy(sim, 3332, { x: turret.x + 12, y: 24 }); // chain jump
    spawnEnemy(sim, 3333, { x: turret.x + 60, y: 80 }); // far outside everything
    run(sim, TICK_RATE);
    expect(sim.state.enemies.find((e) => e.id === 3331)).toBeUndefined();
    expect(sim.state.enemies.find((e) => e.id === 3332)).toBeUndefined();
    expect(sim.state.enemies.find((e) => e.id === 3333)).toBeDefined();
  });

  it('missile homes onto a moving target', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'missile', level: 1 }]));
    const turret = sim.state.turrets[0]!;
    spawnEnemy(sim, 2221, { x: turret.x - 30, y: 70 }, { x: 6, y: -6 }, 2);
    run(sim, TICK_RATE * 6);
    expect(sim.state.enemies.find((e) => e.id === 2221)).toBeUndefined();
  });

  it('tesla chain bonus extends the number of jumps', () => {
    // Five enemies in a chainable row; base tesla reaches 4, +1 bonus reaches 5.
    const make = (bonus: number) => {
      const sim = new Sim(1, configWithTurrets([{ kind: 'tesla', level: 1 }], {
        teslaChainBonus: bonus,
      }));
      const tx = sim.state.turrets[0]!.x;
      for (let i = 0; i < 5; i++) spawnEnemy(sim, 100 + i, { x: tx + 4 + i * 10, y: 22 });
      sim.step([]);
      return sim.state.enemies.filter((e) => e.id >= 100 && e.id <= 104).length;
    };
    expect(make(0)).toBe(1); // 5 - 4 hit = 1 survivor
    expect(make(1)).toBe(0); // 5 - 5 hit = 0 survivors
  });

  it('missile salvo bonus fires multiple missiles per volley', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'missile', level: 1 }], {
      missileSalvoBonus: 2,
    }));
    const tx = sim.state.turrets[0]!.x;
    for (let i = 0; i < 3; i++) spawnEnemy(sim, 200 + i, { x: tx + i * 6, y: 60 }, { x: 0, y: 0 }, 5);
    sim.step([]);
    expect(sim.state.projectiles.filter((p) => p.kind === 'missile')).toHaveLength(3);
  });

  it('railgun pierce bonus widens the hit line', () => {
    const sim = new Sim(1, configWithTurrets([{ kind: 'railgun', level: 1 }], {
      railgunPierceBonus: 6,
    }));
    const tx = sim.state.turrets[0]!.x;
    // Enemies offset sideways from the vertical ray — only hit with extra width.
    spawnEnemy(sim, 300, { x: tx, y: 40 });
    spawnEnemy(sim, 301, { x: tx + 7, y: 42 });
    run(sim, TICK_RATE);
    expect(sim.state.enemies.filter((e) => e.id >= 300 && e.id <= 301)).toHaveLength(0);
  });
});

describe('enemy kinds', () => {
  function nightConfig(night: number) {
    const cfg = defaultNightConfig(night);
    cfg.waves = [];
    return cfg;
  }

  function inject(sim: Sim, kind: EnemyKind, over: Partial<import('../src/core/types').EnemyMissile> = {}) {
    const e: import('../src/core/types').EnemyMissile = {
      id: 555,
      kind,
      pos: { x: 0, y: 50 },
      origin: { x: 0, y: 100 },
      vel: { x: 0, y: -8 },
      hp: 4,
      maxHp: 4,
      scrapReward: 5,
      ...over,
    };
    if (kind === 'phase') {
      e.phased = false;
      e.phaseTimer = 1.5;
    }
    if (kind === 'regenerator') e.regenTimer = 0;
    if (kind === 'carrier') e.spawnTimer = 1.6;
    sim.state.enemies.push(e);
    return e;
  }

  it('splitter spawns two children on death', () => {
    const sim = new Sim(1, nightConfig(5));
    const splitter = inject(sim, 'splitter', { hp: 2, maxHp: 2, vel: { x: 0, y: 0 } });
    // Kill it with an already-grown explosion; check children the same tick
    // (a lingering blast would also catch the fresh children next tick).
    sim.state.explosions.push({
      id: 1,
      pos: { ...splitter.pos },
      age: 0.3,
      maxRadius: 8,
      damage: 10,
      hitEnemyIds: [],
    });
    run(sim, 1);
    expect(sim.state.enemies.find((e) => e.id === 555)).toBeUndefined();
    const children = sim.state.enemies.filter((e) => e.kind === 'swarmer');
    expect(children).toHaveLength(2);
  });

  it('regenerator heals when left alone and resets on hit', () => {
    const sim = new Sim(1, nightConfig(7));
    const regen = inject(sim, 'regenerator', { hp: 2, maxHp: 6, vel: { x: 0, y: 0 } });
    run(sim, TICK_RATE * 2); // past the regen delay
    expect(regen.hp).toBeGreaterThan(2);
    const healed = regen.hp;
    // A hit should interrupt and lower it below the healed value.
    sim.state.explosions.push({
      id: 1,
      pos: { ...regen.pos },
      age: 0,
      maxRadius: 8,
      damage: 1,
      hitEnemyIds: [],
    });
    run(sim, 3);
    expect(regen.hp).toBeLessThan(healed);
  });

  it('phase walker is invulnerable and untargetable while phased', () => {
    const sim = new Sim(1, nightConfig(9));
    const phase = inject(sim, 'phase', { hp: 5, maxHp: 5, vel: { x: 0, y: 0 } });
    phase.phased = true;
    phase.phaseTimer = 10; // stays phased for the test
    const before = phase.hp;
    sim.state.explosions.push({
      id: 1,
      pos: { ...phase.pos },
      age: 0,
      maxRadius: 8,
      damage: 3,
      hitEnemyIds: [],
    });
    run(sim, 4);
    expect(phase.hp).toBe(before); // took no damage while phased
  });

  it('carrier sheds swarmers as it descends', () => {
    const sim = new Sim(1, nightConfig(12));
    inject(sim, 'carrier', { hp: 10, maxHp: 10, pos: { x: 0, y: 60 }, vel: { x: 0, y: -4 } });
    run(sim, TICK_RATE * 4);
    expect(sim.state.enemies.some((e) => e.kind === 'swarmer')).toBe(true);
  });

  it('enemy pool widens with the night number', () => {
    expect(enemyPool(1).map((p) => p.kind)).toEqual(['ballistic']);
    expect(enemyPool(12).map((p) => p.kind)).toContain('carrier');
    expect(enemyPool(12).map((p) => p.kind)).toContain('phase');
  });
});

describe('intercept solver', () => {
  it('aims ahead of a crossing target', () => {
    // Target moving right; correct lead must aim to the right of its position.
    const dir = interceptDirection({ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 20, y: 0 }, 100)!;
    expect(dir).not.toBeNull();
    expect(dir.x).toBeGreaterThan(0.05);
    // And the intercept actually works: projectile reaches the target's
    // future position at the same time.
    const t = 50 / (dir.y * 100); // time to cover vertical distance
    expect(dir.x * 100 * t).toBeCloseTo(20 * t, 1);
  });

  it('aims straight at a stationary target', () => {
    const dir = interceptDirection({ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 0 }, 100)!;
    expect(dir.x).toBeCloseTo(0.6, 5);
    expect(dir.y).toBeCloseTo(0.8, 5);
  });

  it('returns null when the target outruns the projectile', () => {
    const dir = interceptDirection({ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 200 }, 50);
    expect(dir).toBeNull();
  });

  it('rotate by 90 degrees turns +x into +y', () => {
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
  });
});
