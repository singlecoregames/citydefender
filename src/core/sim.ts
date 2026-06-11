/**
 * Headless game simulation. Fixed 60Hz timestep, deterministic under a seed.
 * No three.js or DOM imports allowed in this directory — the renderer, the
 * tests and the balance simulator all drive this same code.
 */
import {
  CANNON,
  CITY,
  DT,
  ECONOMY,
  ENEMY,
  EXPLOSION,
  NIGHT1_WAVES,
  WAVE_BREAK_SECONDS,
  WORLD,
} from './balance';
import { explosionIsDone, explosionIsLethal, explosionRadius } from './explosion';
import { Rng } from './rng';
import type { Command, EnemyMissile, GameEvent, GameState, Vec2 } from './types';

export class Sim {
  readonly state: GameState;
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.state = createInitialState();
  }

  /** Advance the simulation by exactly one tick (1/60s). */
  step(commands: readonly Command[]): readonly GameEvent[] {
    const s = this.state;
    s.events = [];
    if (s.phase === 'ended') return s.events;
    s.tick++;

    for (const cmd of commands) {
      if (cmd.type === 'fire') this.fire(cmd.x, cmd.y);
    }

    this.regenAmmo();
    this.runDirector();
    this.moveInterceptors();
    this.moveEnemies();
    this.updateExplosions();
    this.checkNightEnd();
    return s.events;
  }

  // --- player ---

  private fire(x: number, y: number): void {
    const s = this.state;
    if (s.cannon.ammo <= 0) {
      s.events.push({ type: 'fireDenied', reason: 'noAmmo' });
      return;
    }
    const origin: Vec2 = { x: CANNON.x, y: CANNON.y };
    const target: Vec2 = {
      x: clamp(x, -WORLD.halfWidth, WORLD.halfWidth),
      y: clamp(y, 0, WORLD.height),
    };
    if (dist(origin, target) < CANNON.minTargetDistance) {
      s.events.push({ type: 'fireDenied', reason: 'tooClose' });
      return;
    }
    s.cannon.ammo--;
    s.interceptors.push({
      id: s.nextId++,
      pos: { ...origin },
      origin,
      target,
      speed: CANNON.interceptorSpeed,
    });
    s.events.push({ type: 'fired', target });
  }

  private regenAmmo(): void {
    const c = this.state.cannon;
    if (c.ammo >= CANNON.maxAmmo) return;
    c.reloadTimer -= DT;
    if (c.reloadTimer <= 0) {
      c.ammo++;
      c.reloadTimer += CANNON.reloadSeconds;
    }
  }

  // --- wave director (M1: hardcoded night 1; replaced by waves/ in M2) ---

  private runDirector(): void {
    const s = this.state;
    const d = s.director;
    if (d.done) return;
    d.timer -= DT;
    if (d.timer > 0) return;

    if (d.inBreak) {
      d.inBreak = false;
      d.spawnedInWave = 0;
      s.events.push({ type: 'waveStarted', waveIndex: d.waveIndex });
    }

    const wave = NIGHT1_WAVES[d.waveIndex];
    if (!wave) {
      d.done = true;
      return;
    }
    this.spawnBallistic();
    d.spawnedInWave++;
    if (d.spawnedInWave >= wave.count) {
      d.waveIndex++;
      if (d.waveIndex >= NIGHT1_WAVES.length) {
        d.done = true;
      } else {
        d.inBreak = true;
        d.timer = WAVE_BREAK_SECONDS;
      }
    } else {
      const [lo, hi] = wave.spawnIntervalRange;
      d.timer = this.rng.range(lo, hi);
    }
  }

  private spawnBallistic(): void {
    const s = this.state;
    const origin: Vec2 = {
      x: this.rng.range(-WORLD.halfWidth * 0.95, WORLD.halfWidth * 0.95),
      y: WORLD.height,
    };
    // Aim at a living city most of the time, otherwise a random ground point.
    const living = s.cities.filter((c) => c.hp > 0);
    let targetX: number;
    if (living.length > 0 && this.rng.next() < 0.7) {
      targetX = living[this.rng.int(0, living.length - 1)]!.x + this.rng.range(-3, 3);
    } else {
      targetX = this.rng.range(-WORLD.halfWidth * 0.9, WORLD.halfWidth * 0.9);
    }
    const dir = norm({ x: targetX - origin.x, y: -WORLD.height });
    s.enemies.push({
      id: s.nextId++,
      kind: 'ballistic',
      pos: { ...origin },
      origin,
      vel: { x: dir.x * ENEMY.ballistic.speed, y: dir.y * ENEMY.ballistic.speed },
      hp: ENEMY.ballistic.hp,
      maxHp: ENEMY.ballistic.hp,
      scrapReward: ENEMY.ballistic.scrapReward,
    });
  }

  // --- movement & collisions ---

  private moveInterceptors(): void {
    const s = this.state;
    for (let i = s.interceptors.length - 1; i >= 0; i--) {
      const it = s.interceptors[i]!;
      const toTarget = { x: it.target.x - it.pos.x, y: it.target.y - it.pos.y };
      const distLeft = Math.hypot(toTarget.x, toTarget.y);
      const stepLen = it.speed * DT;
      if (distLeft <= stepLen) {
        s.interceptors.splice(i, 1);
        s.explosions.push({
          id: s.nextId++,
          pos: { ...it.target },
          age: 0,
          maxRadius: EXPLOSION.maxRadius,
          damage: EXPLOSION.damage,
          hitEnemyIds: [],
        });
        s.events.push({ type: 'detonation', pos: { ...it.target } });
      } else {
        it.pos.x += (toTarget.x / distLeft) * stepLen;
        it.pos.y += (toTarget.y / distLeft) * stepLen;
      }
    }
  }

  private moveEnemies(): void {
    const s = this.state;
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i]!;
      e.pos.x += e.vel.x * DT;
      e.pos.y += e.vel.y * DT;
      if (e.pos.y <= 0) {
        s.enemies.splice(i, 1);
        this.handleGroundImpact(e);
      }
    }
  }

  private handleGroundImpact(e: EnemyMissile): void {
    const s = this.state;
    const impact: Vec2 = { x: e.pos.x, y: 0 };
    s.events.push({ type: 'groundImpact', pos: impact });
    for (const city of s.cities) {
      if (city.hp > 0 && Math.abs(city.x - impact.x) <= CITY.hitRadius) {
        city.hp--;
        s.events.push({ type: 'cityHit', cityId: city.id, destroyed: city.hp <= 0 });
      }
    }
  }

  private updateExplosions(): void {
    const s = this.state;
    for (let i = s.explosions.length - 1; i >= 0; i--) {
      const ex = s.explosions[i]!;
      ex.age += DT;
      if (explosionIsLethal(ex)) {
        const r = explosionRadius(ex);
        for (let j = s.enemies.length - 1; j >= 0; j--) {
          const enemy = s.enemies[j]!;
          if (ex.hitEnemyIds.includes(enemy.id)) continue;
          if (dist(ex.pos, enemy.pos) <= r) {
            ex.hitEnemyIds.push(enemy.id);
            enemy.hp -= ex.damage;
            if (enemy.hp <= 0) {
              s.enemies.splice(j, 1);
              s.scrap += enemy.scrapReward;
              s.events.push({
                type: 'enemyKilled',
                pos: { ...enemy.pos },
                reward: enemy.scrapReward,
              });
            }
          }
        }
      }
      if (explosionIsDone(ex)) s.explosions.splice(i, 1);
    }
  }

  // --- night end ---

  private checkNightEnd(): void {
    const s = this.state;
    const citiesAlive = s.cities.some((c) => c.hp > 0);
    if (!citiesAlive) {
      s.scrap = Math.floor(s.scrap * ECONOMY.defeatScrapFactor);
      this.endNight('defeat');
      return;
    }
    if (s.director.done && s.enemies.length === 0 && s.interceptors.length === 0) {
      const living = s.cities.filter((c) => c.hp > 0).length;
      s.scrap += Math.floor(ECONOMY.nightCompleteBonusBase * (living / s.cities.length));
      this.endNight('victory');
    }
  }

  private endNight(outcome: 'victory' | 'defeat'): void {
    const s = this.state;
    s.phase = 'ended';
    s.outcome = outcome;
    s.events.push({ type: 'nightEnded', outcome, scrapEarned: s.scrap });
  }
}

function createInitialState(): GameState {
  return {
    tick: 0,
    phase: 'playing',
    outcome: null,
    cannon: { ammo: CANNON.maxAmmo, reloadTimer: CANNON.reloadSeconds },
    cities: CITY.xs.map((x, i) => ({ id: i, x, hp: CITY.hp, maxHp: CITY.hp })),
    interceptors: [],
    explosions: [],
    enemies: [],
    scrap: 0,
    director: { waveIndex: 0, spawnedInWave: 0, timer: 1.5, inBreak: true, done: false },
    nextId: 1,
    events: [],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function norm(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
