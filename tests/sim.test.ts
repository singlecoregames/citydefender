import { describe, expect, it } from 'vitest';
import { interceptDirection, rotate } from '../src/core/aiming';
import { CANNON, DATA, DT, EXPLOSION, TICK_RATE, TURRETS } from '../src/core/balance';
import { EXPLOSION_TOTAL_SECONDS } from '../src/core/explosion';
import { defaultNightConfig, Sim } from '../src/core/sim';
import { baseStats } from '../src/core/stats';
import { enemyPool } from '../src/core/waves';
import type { Command, EnemyKind, GameEvent, TurretKind } from '../src/core/types';

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

describe('idle auto-fire', () => {
  const IDLE_TICKS = Math.ceil(CANNON.autoFireIdleSeconds * TICK_RATE) + 2;

  function idleSim(): Sim {
    const cfg = defaultNightConfig(1);
    cfg.waves = []; // no natural spawns in these controlled tests
    return new Sim(1, cfg);
  }

  function injectEnemy(
    sim: Sim,
    pos: { x: number; y: number },
    vel = { x: 0, y: 0 },
    hp = 1,
  ): void {
    sim.state.enemies.push({
      id: 9999,
      kind: 'ballistic',
      pos: { ...pos },
      origin: { x: pos.x, y: 100 },
      vel: { ...vel },
      hp,
      maxHp: hp,
      scrapReward: 5,
    });
  }

  it('fires a lead-aimed auto shot once the full magazine idles past the threshold', () => {
    const sim = idleSim();
    injectEnemy(sim, { x: 30, y: 60 });
    run(sim, IDLE_TICKS);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo - 1);
    expect(sim.state.interceptors).toHaveLength(1);
    expect(sim.state.interceptors[0]!.auto).toBe(true);
  });

  it('holds fire (and ammo) when there is no targetable enemy', () => {
    const sim = idleSim();
    injectEnemy(sim, { x: 0, y: 110 }); // still off-screen: keeps the night alive
    run(sim, IDLE_TICKS * 2);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo);
    expect(sim.state.interceptors).toHaveLength(0);
    // The gauge is armed and waiting.
    expect(sim.state.cannon.idleSeconds).toBeGreaterThan(CANNON.autoFireIdleSeconds);
  });

  it('any command resets the idle timer', () => {
    const sim = idleSim();
    injectEnemy(sim, { x: 30, y: 60 });
    const almost = IDLE_TICKS - 30;
    run(sim, almost);
    sim.step([{ type: 'wake' }]);
    run(sim, almost);
    expect(sim.state.interceptors).toHaveLength(0);
    expect(sim.state.cannon.ammo).toBe(CANNON.maxAmmo);
  });

  it('after arming, fires one shot each time the reload refills the magazine', () => {
    const sim = idleSim();
    // Tanky so the blasts don't remove the target between shots.
    injectEnemy(sim, { x: -90, y: 95 }, { x: 0.1, y: -0.1 }, 99);
    let fired = 0;
    const reloadTicks = Math.ceil(CANNON.reloadSeconds * TICK_RATE);
    for (let i = 0; i < IDLE_TICKS + reloadTicks * 2 + 10; i++) {
      for (const ev of sim.step([])) if (ev.type === 'fired') fired++;
    }
    expect(fired).toBe(3); // armed shot + one per completed reload cycle
  });

  it('auto-fire kills do not feed the combo meter', () => {
    const sim = idleSim();
    injectEnemy(sim, { x: 30, y: 60 });
    run(sim, IDLE_TICKS + TICK_RATE * 3);
    expect(sim.state.enemies).toHaveLength(0); // the auto shot killed it
    expect(sim.state.combo).toBe(0);
    expect(sim.state.maxCombo).toBe(0);
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

describe('boss nights', () => {
  function bossConfig(night: number) {
    const cfg = defaultNightConfig(night);
    cfg.waves = []; // isolate the boss
    return cfg;
  }

  it('a boss spawns on boss nights and emits bossSpawned', () => {
    const sim = new Sim(1, bossConfig(10));
    const events = sim.step([]);
    expect(events.some((e) => e.type === 'bossSpawned')).toBe(true);
    expect(sim.state.enemies.some((e) => e.kind === 'boss')).toBe(true);
  });

  it('no boss on non-boss nights', () => {
    const sim = new Sim(1, bossConfig(9));
    sim.step([]);
    expect(sim.state.enemies.some((e) => e.kind === 'boss')).toBe(false);
  });

  it('killing the boss emits cores and lets the night end', () => {
    const sim = new Sim(1, bossConfig(10));
    sim.step([]); // spawn the boss
    const boss = sim.state.enemies.find((e) => e.kind === 'boss')!;
    expect(boss).toBeDefined();
    // Night must not be over while the boss lives.
    run(sim, 30);
    expect(sim.state.phase).toBe('playing');
    // Nuke the boss with a big explosion at its position.
    let coresAwarded = 0;
    boss.pos = { x: 0, y: 60 };
    sim.state.explosions.push({
      id: 1,
      pos: { x: 0, y: 60 },
      age: 0.3,
      maxRadius: 10,
      damage: 100000,
      hitEnemyIds: [],
    });
    for (let i = 0; i < 10; i++) {
      for (const ev of sim.step([])) if (ev.type === 'bossKilled') coresAwarded = ev.cores;
    }
    expect(coresAwarded).toBe(2 + 1); // coresBase + floor(10/10)
  });

  it('the boss sheds minions while alive', () => {
    const sim = new Sim(7, bossConfig(20));
    run(sim, TICK_RATE * 3);
    expect(sim.state.enemies.some((e) => e.kind === 'swarmer')).toBe(true);
  });

  it('a boss reaching the ground flattens every segment and loses the night', () => {
    const sim = new Sim(1, bossConfig(10));
    sim.step([]); // spawn the boss
    const boss = sim.state.enemies.find((e) => e.kind === 'boss')!;
    boss.pos = { x: 40, y: 5 }; // just above the ground band
    boss.vel = { x: 0, y: -20 };
    const events: GameEvent[] = [];
    for (let i = 0; i < 10; i++) events.push(...sim.step([]));
    expect(sim.state.cities.every((c) => c.hp <= 0)).toBe(true);
    expect(events.filter((e) => e.type === 'cityHit').length).toBe(sim.state.cities.length);
    expect(events.some((e) => e.type === 'nightEnded' && e.outcome === 'defeat')).toBe(true);
  });
});

describe('abilities', () => {
  function abilityConfig(levels: { emp?: number; megabomb?: number; slowmo?: number; surge?: number }) {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.abilities = {
      emp: levels.emp ?? 0,
      megabomb: levels.megabomb ?? 0,
      slowmo: levels.slowmo ?? 0,
      surge: levels.surge ?? 0,
    };
    return cfg;
  }

  function addEnemy(sim: Sim, id: number, pos: { x: number; y: number }, vel: { x: number; y: number }, hp = 1) {
    sim.state.enemies.push({
      id, kind: 'ballistic', pos: { ...pos }, origin: { x: pos.x, y: 100 },
      vel: { ...vel }, hp, maxHp: hp, scrapReward: 5,
    });
  }

  it('an unowned ability does nothing', () => {
    const sim = new Sim(1, abilityConfig({}));
    sim.step([{ type: 'ability', ability: 'emp' }]);
    expect(sim.state.ability.empFreeze).toBe(0);
    expect(sim.state.ability.cooldown.emp).toBe(0);
  });

  it('EMP freezes enemies and goes on cooldown', () => {
    const sim = new Sim(1, abilityConfig({ emp: 1 }));
    addEnemy(sim, 1, { x: 0, y: 60 }, { x: 0, y: -20 });
    sim.step([{ type: 'ability', ability: 'emp' }]);
    expect(sim.state.ability.empFreeze).toBeGreaterThan(0);
    expect(sim.state.ability.cooldown.emp).toBeGreaterThan(0);
    const yAfterUse = sim.state.enemies[0]!.pos.y;
    run(sim, 10); // frozen: should not move
    expect(sim.state.enemies[0]!.pos.y).toBeCloseTo(yAfterUse, 5);
  });

  it('cannot fire an ability while it is cooling down', () => {
    const sim = new Sim(1, abilityConfig({ emp: 1 }));
    sim.step([{ type: 'ability', ability: 'emp' }]);
    const cd = sim.state.ability.cooldown.emp;
    sim.step([{ type: 'ability', ability: 'emp' }]); // ignored
    expect(sim.state.ability.cooldown.emp).toBeLessThanOrEqual(cd);
    expect(sim.state.ability.cooldown.emp).toBeGreaterThan(cd - 0.1);
  });

  it('Mega Bomb spawns an explosion that clears enemies', () => {
    const sim = new Sim(1, abilityConfig({ megabomb: 1 }));
    addEnemy(sim, 1, { x: 0, y: 42 }, { x: 0, y: 0 });
    addEnemy(sim, 2, { x: 8, y: 44 }, { x: 0, y: 0 });
    sim.step([{ type: 'ability', ability: 'megabomb' }]);
    expect(sim.state.explosions.length).toBeGreaterThan(0);
    run(sim, 30);
    expect(sim.state.enemies.length).toBe(0);
  });

  it('Time Dilation slows enemies for a while', () => {
    const slow = new Sim(1, abilityConfig({ slowmo: 1 }));
    const normal = new Sim(1, abilityConfig({ slowmo: 1 }));
    addEnemy(slow, 1, { x: 0, y: 60 }, { x: 0, y: -20 });
    addEnemy(normal, 1, { x: 0, y: 60 }, { x: 0, y: -20 });
    slow.step([{ type: 'ability', ability: 'slowmo' }]);
    normal.step([]); // no ability
    run(slow, 30);
    run(normal, 30);
    // The slowed enemy travelled less far (higher y remaining).
    expect(slow.state.enemies[0]!.pos.y).toBeGreaterThan(normal.state.enemies[0]!.pos.y);
  });
});

describe('phase-1 utility nodes (sim hooks)', () => {
  function inject(sim: Sim, id: number, pos: { x: number; y: number }, vel = { x: 0, y: 0 }) {
    sim.state.enemies.push({
      id, kind: 'ballistic', pos: { ...pos }, origin: { x: pos.x, y: 100 },
      vel: { ...vel }, hp: 1, maxHp: 1, scrapReward: 5,
    });
  }

  it('abilityCooldownMul scales every ability cooldown', () => {
    const mk = (mul: number) => {
      const cfg = defaultNightConfig(1);
      cfg.waves = [];
      cfg.abilities = { emp: 1, megabomb: 0, slowmo: 0, surge: 0 };
      cfg.stats = { ...cfg.stats, abilityCooldownMul: mul };
      return new Sim(1, cfg);
    };
    const fast = mk(0.5);
    const norm = mk(1);
    fast.step([{ type: 'ability', ability: 'emp' }]);
    norm.step([{ type: 'ability', ability: 'emp' }]);
    // Both cooldowns already ticked down by one DT within the step.
    expect(fast.state.ability.cooldown.emp + DT).toBeCloseTo(
      (norm.state.ability.cooldown.emp + DT) * 0.5,
      5,
    );
  });

  it('war insurance pays scrap when a city is hit', () => {
    const cfg = defaultNightConfig(1);
    cfg.stats = { ...cfg.stats, cityHitScrap: 8 };
    const sim = new Sim(1, cfg);
    const city = sim.state.cities[0]!;
    inject(sim, 9001, { x: city.x, y: 0.5 }, { x: 0, y: -20 });
    run(sim, 10);
    expect(city.hp).toBe(city.maxHp - 1);
    expect(sim.state.scrap).toBe(8);
  });

  it('chain bounty pays once when one explosion kills 3+', () => {
    const cfg = defaultNightConfig(1);
    cfg.stats = { ...cfg.stats, multiKillScrap: 2 };
    const sim = new Sim(1, cfg);
    inject(sim, 9001, { x: 0, y: 50 });
    inject(sim, 9002, { x: 2, y: 50 });
    inject(sim, 9003, { x: 4, y: 50 });
    sim.state.explosions.push({
      id: 9000, pos: { x: 2, y: 50 }, age: 0,
      maxRadius: EXPLOSION.maxRadius, damage: 1, hitEnemyIds: [],
    });
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.scrap).toBe(3 * 5 + 2); // kill rewards + one bounty
  });

  it('no chain bounty for a double kill', () => {
    const cfg = defaultNightConfig(1);
    cfg.stats = { ...cfg.stats, multiKillScrap: 2 };
    const sim = new Sim(1, cfg);
    inject(sim, 9001, { x: 0, y: 50 });
    inject(sim, 9002, { x: 2, y: 50 });
    sim.state.explosions.push({
      id: 9000, pos: { x: 1, y: 50 }, age: 0,
      maxRadius: EXPLOSION.maxRadius, damage: 1, hitEnemyIds: [],
    });
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.scrap).toBe(2 * 5);
  });

  it('wave dividend pays per wave that finishes spawning', () => {
    const cfg = defaultNightConfig(1);
    cfg.stats = { ...cfg.stats, waveClearScrap: 3 };
    const wave = { count: 1, spawnIntervalRange: [0.1, 0.2] as [number, number], hpScale: 1, speedScale: 1, rewardScale: 1 };
    cfg.waves = [{ ...wave }, { ...wave }];
    const sim = new Sim(1, cfg);
    for (let i = 0; i < TICK_RATE * 60 && !sim.state.director.done; i++) sim.step([]);
    expect(sim.state.director.done).toBe(true);
    // No kills happened (nothing fired), so scrap is exactly the two dividends.
    expect(sim.state.scrap).toBe(6);
  });
});

describe('support buildings', () => {
  function buildingConfig(buildings: { kind: 'harvester' | 'shield' | 'repair'; level: number }[]) {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.buildings = buildings;
    return cfg;
  }

  /** Park a motionless enemy off in the sky so the night never auto-completes
   *  (buildings only tick while the night is being played). */
  function keepAlive(sim: Sim) {
    sim.state.enemies.push({
      id: 90000, kind: 'ballistic', pos: { x: 200, y: 90 }, origin: { x: 200, y: 90 },
      vel: { x: 0, y: 0 }, hp: 1, maxHp: 1, scrapReward: 5,
    });
  }

  it('buildingsFromTree maps building nodes to deployed specs', async () => {
    const { buildingsFromTree } = await import('../src/core/tree');
    expect(buildingsFromTree({})).toEqual([]);
    const specs = buildingsFromTree({ bld_harvester: 2, bld_shield: 1, bld_repair: 3 });
    expect(specs).toContainEqual({ kind: 'harvester', level: 2 });
    expect(specs).toContainEqual({ kind: 'shield', level: 1 });
    expect(specs).toContainEqual({ kind: 'repair', level: 3 });
  });

  it('Scrap Harvester earns scrap over time, scaling with level', () => {
    const sim = new Sim(1, buildingConfig([{ kind: 'harvester', level: 1 }]));
    keepAlive(sim);
    expect(sim.state.scrap).toBe(0);
    run(sim, TICK_RATE * 6); // 0.8/s * 6s = 4.8 → 4 banked
    expect(sim.state.scrap).toBe(4);

    const fast = new Sim(1, buildingConfig([{ kind: 'harvester', level: 3 }]));
    keepAlive(fast);
    run(fast, TICK_RATE * 6); // 2.4/s * 6s = 14.4 → 14 banked
    expect(fast.state.scrap).toBe(14);
  });

  it('Shield Generator absorbs ground impacts up to its charge count', () => {
    const cfg = buildingConfig([{ kind: 'shield', level: 1 }]); // 2 charges
    cfg.stats = { ...cfg.stats, cityMaxHp: 5 };
    const sim = new Sim(1, cfg);
    keepAlive(sim);
    const city = sim.state.cities[0]!;
    city.hp = 5;
    const drop = () => {
      sim.state.enemies.push({
        id: sim.state.nextId++, kind: 'ballistic', pos: { x: city.x, y: 0.4 },
        origin: { x: city.x, y: 100 }, vel: { x: 0, y: -20 }, hp: 1, maxHp: 1, scrapReward: 5,
      });
      run(sim, 3);
    };
    drop(); // absorbed
    drop(); // absorbed
    expect(city.hp).toBe(5);
    expect(sim.state.buildings[0]!.charges).toBe(0);
    drop(); // no charges left → city takes the hit
    expect(city.hp).toBe(4);
  });

  it('Repair Bay heals the most-damaged living city after its interval', () => {
    const cfg = buildingConfig([{ kind: 'repair', level: 1 }]); // 40s interval
    cfg.stats = { ...cfg.stats, cityMaxHp: 3 };
    const sim = new Sim(1, cfg);
    keepAlive(sim);
    sim.state.cities[0]!.hp = 1; // most damaged
    sim.state.cities[1]!.hp = 2;
    run(sim, TICK_RATE * 40 + 2);
    expect(sim.state.cities[0]!.hp).toBe(2); // +1 to the lowest
    expect(sim.state.cities[1]!.hp).toBe(2); // untouched
  });

  it('Repair Bay never overheals or revives a destroyed city', () => {
    const cfg = buildingConfig([{ kind: 'repair', level: 1 }]);
    cfg.stats = { ...cfg.stats, cityMaxHp: 2 };
    const sim = new Sim(1, cfg);
    keepAlive(sim);
    sim.state.cities[0]!.hp = 2; // full
    sim.state.cities[1]!.hp = 0; // destroyed
    sim.state.cities[2]!.hp = 0; // destroyed
    run(sim, TICK_RATE * 45);
    expect(sim.state.cities[0]!.hp).toBe(2); // capped at max, not overhealed
    expect(sim.state.cities[1]!.hp).toBe(0); // stays dead (no revive)
  });
});

describe('phase-3 buildings and Scrap Surge', () => {
  type BKind = 'harvester' | 'shield' | 'repair' | 'radar' | 'jammer' | 'decoy';
  function cfgWith(buildings: { kind: BKind; level: number }[] = []) {
    const cfg = defaultNightConfig(1);
    cfg.waves = [];
    cfg.buildings = buildings;
    return cfg;
  }

  it('Jammer Tower slows enemies inside its field', () => {
    const JAMMER_X = 55;
    const mk = (jam: boolean) => {
      const sim = new Sim(1, cfgWith(jam ? [{ kind: 'jammer', level: 1 }] : []));
      sim.state.enemies.push({
        id: 9001, kind: 'ballistic', pos: { x: JAMMER_X, y: 35 }, origin: { x: JAMMER_X, y: 100 },
        vel: { x: 0, y: -10 }, hp: 1, maxHp: 1, scrapReward: 5,
      });
      return sim;
    };
    const jammed = mk(true);
    const free = mk(false);
    run(jammed, TICK_RATE * 2);
    run(free, TICK_RATE * 2);
    // Slowed enemy fell less far (12% slow → ~2.4 units less over 2s).
    expect(jammed.state.enemies[0]!.pos.y).toBeGreaterThan(free.state.enemies[0]!.pos.y + 1.5);
  });

  it('Doppler Tracking lets turret fire hurt phased enemies', () => {
    const mk = (doppler: boolean) => {
      const cfg = cfgWith([{ kind: 'radar', level: 1 }]);
      cfg.turrets = [{ kind: 'laser', level: 1 }];
      if (doppler) cfg.stats = { ...cfg.stats, dopplerTracking: 1 };
      const sim = new Sim(1, cfg);
      // A phased enemy parked inside laser range (laser at x=-80, range 45).
      sim.state.enemies.push({
        id: 9001, kind: 'phase', pos: { x: -80, y: 30 }, origin: { x: -80, y: 100 },
        vel: { x: 0, y: 0 }, hp: 1, maxHp: 2, scrapReward: 7,
        phased: true, phaseTimer: 9999,
      });
      return sim;
    };
    const withDoppler = mk(true);
    const without = mk(false);
    run(withDoppler, TICK_RATE * 3);
    run(without, TICK_RATE * 3);
    expect(withDoppler.state.enemies).toHaveLength(0); // killed through phase
    expect(without.state.enemies).toHaveLength(1); // untouchable without it
  });

  it('Decoy Beacon redirects a share of spawns toward the beacon', () => {
    const DECOY_X = 90;
    const wave = { count: 40, spawnIntervalRange: [0.05, 0.06] as [number, number], hpScale: 1, speedScale: 1, rewardScale: 1 };
    const landingXs = (decoy: boolean): number[] => {
      const cfg = cfgWith(decoy ? [{ kind: 'decoy', level: 4 }] : []); // 54% pull
      cfg.waves = [{ ...wave }];
      const sim = new Sim(7, cfg);
      const xs: number[] = [];
      for (let i = 0; i < TICK_RATE * 10 && xs.length < 30; i++) {
        sim.step([]);
        for (const e of sim.state.enemies) {
          if (xs.length >= 30) break;
          // Project the dive to the ground: x at y=0.
          const t = e.pos.y / -e.vel.y;
          if (e.vel.y < 0) xs.push(e.pos.x + e.vel.x * t);
        }
        sim.state.enemies.length = 0; // measure each spawn once
      }
      return xs;
    };
    const near = (xs: number[]) => xs.filter((x) => Math.abs(x - DECOY_X) <= 8).length;
    const withDecoy = near(landingXs(true));
    const without = near(landingXs(false));
    // 54% of 30 spawns ≈ 16 expected near the decoy; ~0–2 by chance without.
    expect(withDecoy).toBeGreaterThanOrEqual(8);
    expect(withDecoy).toBeGreaterThan(without + 5);
  });

  it('Scrap Surge doubles kill scrap while active', () => {
    const cfg = cfgWith();
    cfg.abilities = { emp: 0, megabomb: 0, slowmo: 0, surge: 1 };
    const sim = new Sim(1, cfg);
    sim.state.enemies.push({
      id: 9001, kind: 'ballistic', pos: { x: 0, y: 50 }, origin: { x: 0, y: 100 },
      vel: { x: 0, y: 0 }, hp: 1, maxHp: 1, scrapReward: 5,
    });
    sim.state.explosions.push({
      id: 9000, pos: { x: 0, y: 50 }, age: 0,
      maxRadius: EXPLOSION.maxRadius, damage: 1, hitEnemyIds: [],
    });
    sim.step([{ type: 'ability', ability: 'surge' }]);
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.scrap).toBe(10); // 5 × surge factor 2
    expect(sim.state.ability.cooldown.surge).toBeGreaterThan(0);
  });
});

describe('combo / overcharge / data (skilled-play layer)', () => {
  function bareConfig(night = 1, stats: Partial<ReturnType<typeof baseStats>> = {}) {
    const cfg = defaultNightConfig(night);
    cfg.waves = [];
    cfg.boss = false;
    cfg.stats = { ...cfg.stats, ...stats };
    return cfg;
  }

  function injectEnemy(sim: Sim, id: number, pos: { x: number; y: number }, vel = { x: 0, y: 0 }) {
    sim.state.enemies.push({
      id,
      kind: 'ballistic',
      pos: { ...pos },
      origin: { x: pos.x, y: 100 },
      vel: { ...vel },
      hp: 1,
      maxHp: 1,
      scrapReward: 10,
    });
  }

  function injectExplosion(
    sim: Sim,
    pos: { x: number; y: number },
    source?: 'manual' | 'turret' | 'ability',
  ) {
    sim.state.explosions.push({
      id: sim.state.nextId++,
      pos: { ...pos },
      age: 0,
      maxRadius: EXPLOSION.maxRadius,
      damage: 1,
      hitEnemyIds: [],
      source,
    });
  }

  it('manual-explosion kills build the combo; turret kills do not', () => {
    const sim = new Sim(1, bareConfig());
    injectEnemy(sim, 9001, { x: 0, y: 50 });
    injectEnemy(sim, 9002, { x: 3, y: 50 });
    injectExplosion(sim, { x: 1, y: 50 }, 'manual');
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.combo).toBe(2);
    expect(sim.state.maxCombo).toBe(2);

    const sim2 = new Sim(1, bareConfig());
    injectEnemy(sim2, 9001, { x: 0, y: 50 });
    injectExplosion(sim2, { x: 0, y: 50 }, 'turret');
    run(sim2, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim2.state.enemies).toHaveLength(0);
    expect(sim2.state.combo).toBe(0);
  });

  it('a whiffed manual blast breaks the combo (Combo Memory keeps a cut)', () => {
    const sim = new Sim(1, bareConfig());
    sim.state.combo = 10;
    injectExplosion(sim, { x: 0, y: 80 }, 'manual');
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.combo).toBe(0);

    const sim2 = new Sim(1, bareConfig(1, { comboRetention: 0.25 }));
    sim2.state.combo = 10;
    injectExplosion(sim2, { x: 0, y: 80 }, 'manual');
    let lost = 0;
    for (let i = 0; i < EXPLOSION_TOTAL_SECONDS * TICK_RATE + 2; i++) {
      for (const ev of sim2.step([])) if (ev.type === 'comboBroken') lost = ev.lost;
    }
    expect(sim2.state.combo).toBe(2); // floor(10 × 0.25)
    expect(lost).toBe(8);
  });

  it('a city taking damage breaks the combo and voids the perfect bonus', () => {
    const sim = new Sim(1, bareConfig());
    sim.state.combo = 7;
    const city = sim.state.cities[0]!;
    injectEnemy(sim, 9001, { x: city.x, y: 0.5 }, { x: 0, y: -20 });
    run(sim, 10);
    expect(sim.state.cityDamageTaken).toBe(1);
    expect(sim.state.combo).toBe(0);
  });

  it('the combo multiplies kill rewards (capped at maxStacks)', () => {
    const sim = new Sim(1, bareConfig());
    sim.state.combo = 100; // beyond the cap of 50 → ×2
    injectEnemy(sim, 9001, { x: 0, y: 50 });
    injectExplosion(sim, { x: 0, y: 50 }, 'manual');
    run(sim, Math.ceil(EXPLOSION_TOTAL_SECONDS * TICK_RATE));
    expect(sim.state.scrap).toBe(20); // 10 × (1 + 0.02×50)
  });

  it('Overcharge Shot adds a share of turret DPS to manual blasts', () => {
    const cfg = bareConfig(1, { overchargeRate: 1 });
    cfg.turrets = [{ kind: 'gatling', level: 1 }];
    const sim = new Sim(1, cfg);
    sim.step([{ type: 'fire', x: 0, y: 60 }]);
    run(sim, TICK_RATE); // interceptor lands ~0.8s in; explosion still alive
    const manual = sim.state.explosions.find((e) => e.source === 'manual');
    expect(manual).toBeDefined();
    // gatling dps = damage 1 × fireRate 1.1; rate 1 → 1 + 1.1
    expect(manual!.damage).toBeCloseTo(1 + TURRETS.gatling.damage * TURRETS.gatling.fireRate, 5);
  });

  it('a perfect victory from the unlock night pays Data; early nights pay none', () => {
    const sim = new Sim(1, bareConfig(DATA.unlockNight));
    let data = -1;
    for (let i = 0; i < TICK_RATE * 5 && data < 0; i++) {
      for (const ev of sim.step([])) if (ev.type === 'nightEnded') data = ev.dataEarned;
    }
    expect(data).toBe(DATA.perfectBase + Math.floor(DATA.unlockNight / 10));

    const early = new Sim(1, bareConfig(DATA.unlockNight - 1));
    let earlyData = -1;
    for (let i = 0; i < TICK_RATE * 5 && earlyData < 0; i++) {
      for (const ev of early.step([])) if (ev.type === 'nightEnded') earlyData = ev.dataEarned;
    }
    expect(earlyData).toBe(0);
  });

  it('peak combo pays Data even without a perfect night; defeat pays nothing', () => {
    const sim = new Sim(1, bareConfig(DATA.unlockNight));
    sim.state.maxCombo = 30;
    sim.state.cityDamageTaken = 1;
    let data = -1;
    for (let i = 0; i < TICK_RATE * 5 && data < 0; i++) {
      for (const ev of sim.step([])) if (ev.type === 'nightEnded') data = ev.dataEarned;
    }
    expect(data).toBe(Math.floor(30 / DATA.comboPerData));

    const lost = new Sim(1, bareConfig(DATA.unlockNight));
    lost.state.maxCombo = 60;
    for (const c of lost.state.cities) c.hp = 0;
    const events = lost.step([]);
    const ended = events.find((e) => e.type === 'nightEnded');
    expect(ended && ended.type === 'nightEnded' && ended.dataEarned).toBe(0);
  });

  it('Threat Analysis retargets turrets onto ground-threatening missiles', () => {
    // Laser (never misses): a low missile falling onto an already-dead ground
    // segment vs a higher missile on course for a living one.
    const threatening = { x: -20, y: 30 }; // middle segment (alive)
    const harmless = { x: -80, y: 20 }; // left segment (killed below)
    const kill = (threat: boolean): number => {
      const sim = new Sim(1, bareConfig(1, threat ? { threatTargeting: 1 } : {}));
      sim.state.cities[0]!.hp = 0; // the left third is already rubble
      sim.state.turrets.push({ id: 50, kind: 'laser', level: 1, x: -45, y: 2, cooldown: 0 });
      injectEnemy(sim, 9001, threatening, { x: 0, y: -10 });
      injectEnemy(sim, 9002, harmless, { x: 0, y: -10 });
      sim.step([]);
      return sim.state.enemies[0]!.id; // the survivor of the first laser tick
    };
    expect(kill(false)).toBe(9001); // default: lowest enemy dies first → 9002 gone
    expect(kill(true)).toBe(9002); // threat analysis: ground-bound 9001 dies first
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
