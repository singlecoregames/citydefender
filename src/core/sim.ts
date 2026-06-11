/**
 * Headless game simulation for a single night. Fixed 60Hz timestep,
 * deterministic under a seed. No three.js or DOM imports allowed in this
 * directory — the renderer, the tests and the balance simulator all drive
 * this same code.
 */
import { CANNON, CITY, DT, ECONOMY, ENEMY, TURRET, WAVE_BREAK_SECONDS, WORLD } from './balance';
import { interceptDirection, rotate } from './aiming';
import { explosionIsDone, explosionIsLethal, explosionRadius } from './explosion';
import { Rng } from './rng';
import { baseStats, type DerivedStats } from './stats';
import type { Command, EnemyMissile, GameEvent, GameState, Turret, Vec2 } from './types';
import { generateNight, type WaveSpec } from './waves';

/** Everything a single night's sim needs beyond its RNG seed. */
export interface NightConfig {
  night: number;
  waves: WaveSpec[];
  stats: DerivedStats;
}

/** Default config = night 1 with base stats (used by tests and the prototype). */
export function defaultNightConfig(night = 1): NightConfig {
  return { night, waves: generateNight(night), stats: baseStats() };
}

export class Sim {
  readonly state: GameState;
  private readonly rng: Rng;
  private readonly cfg: NightConfig;

  constructor(seed: number, config: NightConfig = defaultNightConfig()) {
    this.rng = new Rng(seed);
    this.cfg = config;
    this.state = createInitialState(config);
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
    this.updateTurrets();
    this.moveProjectiles();
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
      speed: this.cfg.stats.interceptorSpeed,
    });
    s.events.push({ type: 'fired', target });
  }

  private regenAmmo(): void {
    const c = this.state.cannon;
    if (c.ammo >= this.cfg.stats.maxAmmo) return;
    c.reloadTimer -= DT;
    if (c.reloadTimer <= 0) {
      c.ammo++;
      c.reloadTimer += this.cfg.stats.reloadSeconds;
    }
  }

  // --- wave director ---

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

    const wave = this.cfg.waves[d.waveIndex];
    if (!wave) {
      d.done = true;
      return;
    }
    this.spawnBallistic(wave);
    d.spawnedInWave++;
    if (d.spawnedInWave >= wave.count) {
      d.waveIndex++;
      if (d.waveIndex >= this.cfg.waves.length) {
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

  private spawnBallistic(wave: WaveSpec): void {
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
    const hp = Math.max(1, Math.round(ENEMY.ballistic.hp * wave.hpScale));
    const speed = ENEMY.ballistic.speed * wave.speedScale;
    s.enemies.push({
      id: s.nextId++,
      kind: 'ballistic',
      pos: { ...origin },
      origin,
      vel: { x: dir.x * speed, y: dir.y * speed },
      hp,
      maxHp: hp,
      scrapReward: Math.max(1, Math.round(ENEMY.ballistic.scrapReward * wave.rewardScale)),
    });
  }

  // --- automated turrets ---

  private updateTurrets(): void {
    const s = this.state;
    const range = this.cfg.stats.turretRange;
    const fireInterval = 1 / this.cfg.stats.turretFireRate;
    for (const turret of s.turrets) {
      turret.cooldown -= DT;
      if (turret.cooldown > 0) continue;
      const target = this.selectTarget(turret, range);
      if (!target) continue;
      const origin = { x: turret.x, y: turret.y };
      // Lead the moving target; fall back to direct aim if no intercept exists.
      const lead =
        interceptDirection(origin, target.pos, target.vel, TURRET.projectileSpeed) ??
        norm({ x: target.pos.x - turret.x, y: target.pos.y - turret.y });
      // Imperfect gunnery: a random angular error, so distant shots can miss.
      const spread = (this.rng.range(-TURRET.aimSpreadDeg, TURRET.aimSpreadDeg) * Math.PI) / 180;
      const dir = rotate(lead, spread);
      s.projectiles.push({
        id: s.nextId++,
        pos: origin,
        vel: { x: dir.x * TURRET.projectileSpeed, y: dir.y * TURRET.projectileSpeed },
        damage: this.cfg.stats.turretDamage,
      });
      turret.cooldown += fireInterval;
    }
  }

  /** Pick the most-progressed (lowest) enemy within range — the biggest threat
   *  to the cities. Deterministic tie-break by id keeps replays stable. */
  private selectTarget(turret: Turret, range: number): EnemyMissile | null {
    const s = this.state;
    let best: EnemyMissile | null = null;
    for (const e of s.enemies) {
      if (dist({ x: turret.x, y: turret.y }, e.pos) > range) continue;
      if (!best || e.pos.y < best.pos.y || (e.pos.y === best.pos.y && e.id < best.id)) {
        best = e;
      }
    }
    return best;
  }

  private moveProjectiles(): void {
    const s = this.state;
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const p = s.projectiles[i]!;
      p.pos.x += p.vel.x * DT;
      p.pos.y += p.vel.y * DT;
      // Off-screen → discard.
      if (
        p.pos.y < -2 ||
        p.pos.y > WORLD.height + 5 ||
        Math.abs(p.pos.x) > WORLD.halfWidth + 5
      ) {
        s.projectiles.splice(i, 1);
        continue;
      }
      // Hit the nearest enemy within the projectile's radius.
      let hit = -1;
      let hitDist: number = TURRET.projectileHitRadius;
      for (let j = 0; j < s.enemies.length; j++) {
        const d = dist(p.pos, s.enemies[j]!.pos);
        if (d <= hitDist) {
          hit = j;
          hitDist = d;
        }
      }
      if (hit >= 0) {
        this.damageEnemy(hit, p.damage);
        s.projectiles.splice(i, 1);
      }
    }
  }

  /** Apply damage to enemy at index; on death remove it and award scrap.
   *  Shared by explosions and turret projectiles. */
  private damageEnemy(index: number, dmg: number): void {
    const s = this.state;
    const enemy = s.enemies[index];
    if (!enemy) return;
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      s.enemies.splice(index, 1);
      const reward = this.scaledScrap(enemy.scrapReward);
      s.scrap += reward;
      s.events.push({ type: 'enemyKilled', pos: { ...enemy.pos }, reward });
    }
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
          maxRadius: this.cfg.stats.explosionMaxRadius,
          damage: this.cfg.stats.explosionDamage,
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
      if (city.hp > 0 && Math.abs(city.x - impact.x) <= this.cfg.stats.cityHitRadius) {
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
            this.damageEnemy(j, ex.damage);
          }
        }
      }
      if (explosionIsDone(ex)) s.explosions.splice(i, 1);
    }
  }

  private scaledScrap(base: number): number {
    return Math.max(1, Math.round(base * this.cfg.stats.scrapMul));
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
    if (
      s.director.done &&
      s.enemies.length === 0 &&
      s.interceptors.length === 0 &&
      s.projectiles.length === 0
    ) {
      const living = s.cities.filter((c) => c.hp > 0).length;
      const bonus =
        ECONOMY.nightCompleteBonusBase *
        Math.pow(ECONOMY.nightCompleteBonusGrowth, s.night - 1) *
        this.cfg.stats.nightBonusMul;
      s.scrap += Math.floor(this.scaledScrap(bonus) * (living / s.cities.length));
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

function createInitialState(cfg: NightConfig): GameState {
  return {
    tick: 0,
    night: cfg.night,
    phase: 'playing',
    outcome: null,
    cannon: { ammo: cfg.stats.maxAmmo, maxAmmo: cfg.stats.maxAmmo, reloadTimer: cfg.stats.reloadSeconds },
    cities: CITY.xs.map((x, i) => ({ id: i, x, hp: cfg.stats.cityMaxHp, maxHp: cfg.stats.cityMaxHp })),
    interceptors: [],
    explosions: [],
    enemies: [],
    turrets: TURRET.slotXs
      .slice(0, cfg.stats.turretCount)
      .map((x, i) => ({ id: i, x, y: TURRET.y, cooldown: 0 })),
    projectiles: [],
    scrap: 0,
    director: {
      waveIndex: 0,
      totalWaves: cfg.waves.length,
      spawnedInWave: 0,
      timer: 1.5,
      inBreak: true,
      done: false,
    },
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
