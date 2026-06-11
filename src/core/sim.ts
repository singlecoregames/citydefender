/**
 * Headless game simulation for a single night. Fixed 60Hz timestep,
 * deterministic under a seed. No three.js or DOM imports allowed in this
 * directory — the renderer, the tests and the balance simulator all drive
 * this same code.
 */
import {
  BOSS,
  BOSS_NIGHT_INTERVAL,
  CANNON,
  CITY,
  DT,
  ECONOMY,
  ENEMY,
  SWARMER_GROUP,
  TURRET,
  TURRETS,
  WAVE_BREAK_SECONDS,
  WORLD,
} from './balance';
import { interceptDirection, rotate } from './aiming';
import { explosionIsDone, explosionIsLethal, explosionRadius } from './explosion';
import { Rng } from './rng';
import { baseStats, type DerivedStats } from './stats';
import type { TurretSpec } from './tree';
import type { Command, EnemyKind, EnemyMissile, GameEvent, GameState, Turret, Vec2 } from './types';

/** Enemy kinds the wave director can spawn (everything except the boss). */
type SpawnableKind = Exclude<EnemyKind, 'boss'>;
import { enemyPool, generateNight, type WaveSpec } from './waves';

/** Everything a single night's sim needs beyond its RNG seed. */
export interface NightConfig {
  night: number;
  waves: WaveSpec[];
  stats: DerivedStats;
  /** Deployed turrets (kind + node level), derived from the skill tree. */
  turrets: TurretSpec[];
  /** Whether a boss appears this night. */
  boss: boolean;
}

/** Default config = night 1 with base stats (used by tests and the prototype). */
export function defaultNightConfig(night = 1): NightConfig {
  return {
    night,
    waves: generateNight(night),
    stats: baseStats(),
    turrets: [],
    boss: night % BOSS_NIGHT_INTERVAL === 0,
  };
}

export class Sim {
  readonly state: GameState;
  private readonly rng: Rng;
  private readonly cfg: NightConfig;
  private bossNeedsSpawn: boolean;

  constructor(seed: number, config: NightConfig = defaultNightConfig()) {
    this.rng = new Rng(seed);
    this.cfg = config;
    this.bossNeedsSpawn = config.boss;
    this.state = createInitialState(config);
  }

  /** Advance the simulation by exactly one tick (1/60s). */
  step(commands: readonly Command[]): readonly GameEvent[] {
    const s = this.state;
    s.events = [];
    if (s.phase === 'ended') return s.events;
    s.tick++;

    if (this.bossNeedsSpawn) {
      this.spawnBoss();
      this.bossNeedsSpawn = false;
    }

    for (const cmd of commands) {
      if (cmd.type === 'fire') this.fire(cmd.x, cmd.y);
    }

    this.regenAmmo();
    this.runDirector();
    this.updateEnemyBehavior();
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
    this.spawnFromPool(wave);
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

  /** Pick a kind from the night's pool and spawn it (swarmers come in groups). */
  private spawnFromPool(wave: WaveSpec): void {
    const kind = this.chooseEnemyKind();
    if (kind === 'swarmer') {
      for (let i = 0; i < SWARMER_GROUP; i++) this.spawnEnemy('swarmer', wave);
    } else {
      this.spawnEnemy(kind, wave);
    }
  }

  private chooseEnemyKind(): SpawnableKind {
    const pool = enemyPool(this.cfg.night);
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let r = this.rng.next() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) return p.kind as SpawnableKind;
    }
    return 'ballistic';
  }

  /** Spawn one enemy of a kind, descending toward a (usually living) city.
   *  Bosses use spawnBoss(), not this. */
  private spawnEnemy(kind: SpawnableKind, wave: WaveSpec): EnemyMissile {
    const s = this.state;
    const spec = ENEMY[kind];
    const origin: Vec2 = {
      x: this.rng.range(-WORLD.halfWidth * 0.95, WORLD.halfWidth * 0.95),
      y: WORLD.height + WORLD.spawnMargin,
    };
    const living = s.cities.filter((c) => c.hp > 0);
    let targetX: number;
    if (living.length > 0 && this.rng.next() < 0.7) {
      targetX = living[this.rng.int(0, living.length - 1)]!.x + this.rng.range(-3, 3);
    } else {
      targetX = this.rng.range(-WORLD.halfWidth * 0.9, WORLD.halfWidth * 0.9);
    }
    // Aim at the ground target so the descent angle is correct from off-screen.
    const dir = norm({ x: targetX - origin.x, y: -origin.y });
    const hp = Math.max(1, Math.round(spec.hp * wave.hpScale));
    const speed = spec.speed * wave.speedScale;
    const enemy: EnemyMissile = {
      id: s.nextId++,
      kind,
      pos: { ...origin },
      origin,
      vel: { x: dir.x * speed, y: dir.y * speed },
      hp,
      maxHp: hp,
      scrapReward: Math.max(1, Math.round(spec.scrapReward * wave.rewardScale)),
    };
    if (kind === 'phase') {
      enemy.phased = false;
      enemy.phaseTimer = ENEMY.phase.phaseInterval;
    } else if (kind === 'regenerator') {
      enemy.regenTimer = 0;
    } else if (kind === 'carrier') {
      enemy.spawnTimer = ENEMY.carrier.spawnInterval;
    }
    s.enemies.push(enemy);
    return enemy;
  }

  /** Spawn the night's boss: huge hp, slow descent, sheds minions. */
  private spawnBoss(): void {
    const s = this.state;
    const hpScale = this.cfg.waves[0]?.hpScale ?? 1;
    const hp = Math.max(1, Math.round(BOSS.hp * hpScale));
    s.enemies.push({
      id: s.nextId++,
      kind: 'boss',
      pos: { x: 0, y: WORLD.height + WORLD.spawnMargin },
      origin: { x: 0, y: WORLD.height + WORLD.spawnMargin },
      vel: { x: 0, y: -BOSS.speed },
      hp,
      maxHp: hp,
      scrapReward: BOSS.scrapReward,
      spawnTimer: BOSS.spawnInterval,
    });
    s.events.push({ type: 'bossSpawned' });
  }

  /** Per-tick special behaviour: phasing, regeneration, minion spawning. */
  private updateEnemyBehavior(): void {
    const s = this.state;
    for (const e of s.enemies) {
      switch (e.kind) {
        case 'boss': {
          // Decelerate to a hover height so the fight has room.
          if (e.pos.y <= BOSS.hoverY && e.vel.y < 0) e.vel.y = -BOSS.speed * 0.25;
          e.spawnTimer! -= DT;
          if (e.spawnTimer! <= 0) {
            this.spawnChild('swarmer', e, 1.3);
            e.spawnTimer! += BOSS.spawnInterval;
          }
          break;
        }
        case 'phase': {
          e.phaseTimer! -= DT;
          if (e.phaseTimer! <= 0) {
            e.phased = !e.phased;
            e.phaseTimer = e.phased ? ENEMY.phase.phaseDuration : ENEMY.phase.phaseInterval;
          }
          break;
        }
        case 'regenerator': {
          e.regenTimer! += DT;
          if (e.regenTimer! >= ENEMY.regenerator.regenDelay && e.hp < e.maxHp) {
            e.hp = Math.min(e.maxHp, e.hp + ENEMY.regenerator.regenPerSec * DT);
          }
          break;
        }
        case 'carrier': {
          e.spawnTimer! -= DT;
          if (e.spawnTimer! <= 0 && e.pos.y > 8) {
            this.spawnChild('swarmer', e, 1.4);
            e.spawnTimer! += ENEMY.carrier.spawnInterval;
          }
          break;
        }
      }
    }
  }

  /** Spawn a child enemy at a parent's position (carrier shedding, splitter
   *  death). Inherits a fraction of the parent's hp scaling via its own base. */
  private spawnChild(kind: 'swarmer', parent: EnemyMissile, speedMul: number): void {
    const s = this.state;
    const spec = ENEMY[kind];
    // Recover the night's hp scale from the parent (boss has no ENEMY entry).
    const parentBaseHp = parent.kind === 'boss' ? BOSS.hp : ENEMY[parent.kind].hp;
    const hpScale = parent.maxHp / Math.max(1, parentBaseHp);
    const hp = Math.max(1, Math.round(spec.hp * hpScale));
    const angle = this.rng.range(-0.5, 0.5);
    const dir = rotate({ x: 0, y: -1 }, angle);
    const speed = spec.speed * speedMul;
    s.enemies.push({
      id: s.nextId++,
      kind,
      pos: { x: parent.pos.x, y: parent.pos.y },
      origin: { x: parent.pos.x, y: parent.pos.y },
      vel: { x: dir.x * speed, y: dir.y * speed },
      hp,
      maxHp: hp,
      scrapReward: Math.max(1, spec.scrapReward),
    });
  }

  // --- automated turrets ---

  private updateTurrets(): void {
    for (const turret of this.state.turrets) {
      turret.cooldown -= DT;
      if (turret.cooldown > 0) continue;
      const spec = TURRETS[turret.kind];
      const range = spec.range * this.cfg.stats.turretRangeMul;
      const damage =
        spec.damage *
        (1 + TURRET.levelDamageBonus * (turret.level - 1)) *
        this.cfg.stats.turretDamageMul;
      const fired = this.fireTurret(turret, range, damage);
      if (fired) {
        const kindRate = turret.kind === 'gatling' ? this.cfg.stats.gatlingFireRateMul : 1;
        turret.cooldown += 1 / (spec.fireRate * this.cfg.stats.turretFireRateMul * kindRate);
      } else {
        turret.cooldown = 0; // stay ready; retry next tick
      }
    }
  }

  /** Fire one shot for this turret's kind. Returns false when no target. */
  private fireTurret(turret: Turret, range: number, damage: number): boolean {
    const s = this.state;
    const spec = TURRETS[turret.kind];
    const origin: Vec2 = { x: turret.x, y: turret.y };
    const target = this.selectTarget(origin, range);
    if (!target) return false;

    switch (turret.kind) {
      case 'gatling': {
        const dir = this.aimWithSpread(origin, target, spec.projectileSpeed!, spec.spreadDeg!);
        s.projectiles.push({
          id: s.nextId++,
          kind: 'gatling',
          pos: { ...origin },
          vel: { x: dir.x * spec.projectileSpeed!, y: dir.y * spec.projectileSpeed! },
          damage,
          ttl: 4,
        });
        return true;
      }
      case 'flak': {
        // Burst at the predicted intercept point (plus aim error).
        const dir = this.aimWithSpread(origin, target, spec.projectileSpeed!, spec.spreadDeg!);
        const flight = dist(origin, target.pos) / spec.projectileSpeed!;
        s.projectiles.push({
          id: s.nextId++,
          kind: 'flak',
          pos: { ...origin },
          vel: { x: dir.x * spec.projectileSpeed!, y: dir.y * spec.projectileSpeed! },
          damage,
          ttl: 6,
          fuse: flight,
          burstRadius: spec.burstRadius! * this.cfg.stats.flakRadiusMul,
        });
        return true;
      }
      case 'laser': {
        // Instant single-target hit; never misses.
        this.damageEnemy(target, damage * this.cfg.stats.laserDamageMul);
        s.events.push({ type: 'beam', kind: 'laser', points: [origin, { ...target.pos }] });
        return true;
      }
      case 'missile': {
        // Salvo: one homing missile per target, leading with the most-
        // progressed enemies; extra missiles re-target the primary.
        const salvo = 1 + this.cfg.stats.missileSalvoBonus;
        const targets = this.selectTargets(origin, range, salvo);
        for (let k = 0; k < salvo; k++) {
          const tgt = targets[k] ?? target;
          const dir = norm({ x: tgt.pos.x - origin.x, y: tgt.pos.y - origin.y });
          // Fan extra missiles out slightly so they don't perfectly overlap.
          const fan = rotate(dir, ((k - (salvo - 1) / 2) * 10 * Math.PI) / 180);
          s.projectiles.push({
            id: s.nextId++,
            kind: 'missile',
            pos: { ...origin },
            vel: { x: fan.x * spec.homingSpeed!, y: fan.y * spec.homingSpeed! },
            damage,
            ttl: 8,
            targetId: tgt.id,
          });
        }
        return true;
      }
      case 'railgun': {
        // Instant piercing ray through the target direction.
        const lead =
          interceptDirection(origin, target.pos, target.vel, 1e6) ??
          norm({ x: target.pos.x - origin.x, y: target.pos.y - origin.y });
        const spreadRad = (this.rng.range(-spec.spreadDeg!, spec.spreadDeg!) * Math.PI) / 180;
        const dir = rotate(lead, spreadRad);
        const hits = s.enemies.filter((e) => {
          const rx = e.pos.x - origin.x;
          const ry = e.pos.y - origin.y;
          const along = rx * dir.x + ry * dir.y;
          if (along < 0) return false;
          const off = Math.abs(rx * dir.y - ry * dir.x);
          return off <= spec.pierceWidth! + this.cfg.stats.railgunPierceBonus;
        });
        for (const e of hits) this.damageEnemy(e, damage);
        const reach = WORLD.height * 1.6;
        s.events.push({
          type: 'beam',
          kind: 'railgun',
          points: [origin, { x: origin.x + dir.x * reach, y: origin.y + dir.y * reach }],
        });
        return true;
      }
      case 'tesla': {
        // Chain lightning: jump up to chainCount targets, each within
        // chainRadius of the previous one.
        const chain: EnemyMissile[] = [target];
        const maxChain = spec.chainCount! + this.cfg.stats.teslaChainBonus;
        while (chain.length < maxChain) {
          const last = chain[chain.length - 1]!;
          let next: EnemyMissile | null = null;
          let bestD = spec.chainRadius!;
          for (const e of s.enemies) {
            if (chain.includes(e)) continue;
            const d = dist(last.pos, e.pos);
            if (d <= bestD) {
              bestD = d;
              next = e;
            }
          }
          if (!next) break;
          chain.push(next);
        }
        const points = [origin, ...chain.map((e) => ({ ...e.pos }))];
        for (const e of chain) this.damageEnemy(e, damage);
        s.events.push({ type: 'beam', kind: 'tesla', points });
        return true;
      }
    }
  }

  /** Lead-aim at a moving target, then apply a random angular error. */
  private aimWithSpread(
    origin: Vec2,
    target: EnemyMissile,
    projectileSpeed: number,
    spreadDeg: number,
  ): Vec2 {
    const lead =
      interceptDirection(origin, target.pos, target.vel, projectileSpeed) ??
      norm({ x: target.pos.x - origin.x, y: target.pos.y - origin.y });
    const spreadRad = (this.rng.range(-spreadDeg, spreadDeg) * Math.PI) / 180;
    return rotate(lead, spreadRad);
  }

  /** Pick the most-progressed (lowest) enemy within range — the biggest threat
   *  to the cities. Deterministic tie-break by id keeps replays stable. */
  private selectTarget(origin: Vec2, range: number): EnemyMissile | null {
    let best: EnemyMissile | null = null;
    for (const e of this.state.enemies) {
      if (e.phased) continue; // can't be targeted while phased
      if (dist(origin, e.pos) > range) continue;
      if (!best || e.pos.y < best.pos.y || (e.pos.y === best.pos.y && e.id < best.id)) {
        best = e;
      }
    }
    return best;
  }

  /** The `count` most-progressed enemies within range (for missile salvos). */
  private selectTargets(origin: Vec2, range: number, count: number): EnemyMissile[] {
    return this.state.enemies
      .filter((e) => !e.phased && dist(origin, e.pos) <= range)
      .sort((a, b) => a.pos.y - b.pos.y || a.id - b.id)
      .slice(0, count);
  }

  private moveProjectiles(): void {
    const s = this.state;
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const p = s.projectiles[i]!;
      p.ttl -= DT;

      // Missiles steer toward their target while it lives.
      if (p.targetId !== undefined) {
        const target = s.enemies.find((e) => e.id === p.targetId);
        if (target) {
          const speed = Math.hypot(p.vel.x, p.vel.y);
          const dir = norm({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
          p.vel.x = dir.x * speed;
          p.vel.y = dir.y * speed;
        }
      }

      p.pos.x += p.vel.x * DT;
      p.pos.y += p.vel.y * DT;

      // Flak shells burst when the fuse runs out.
      if (p.fuse !== undefined) {
        p.fuse -= DT;
        if (p.fuse <= 0) {
          s.explosions.push({
            id: s.nextId++,
            pos: { ...p.pos },
            age: 0,
            maxRadius: p.burstRadius!,
            damage: p.damage,
            hitEnemyIds: [],
          });
          s.events.push({ type: 'detonation', pos: { ...p.pos } });
          s.projectiles.splice(i, 1);
          continue;
        }
      }

      // Expired or off-screen → discard.
      if (
        p.ttl <= 0 ||
        p.pos.y < -2 ||
        p.pos.y > WORLD.height + WORLD.spawnMargin + 5 ||
        Math.abs(p.pos.x) > WORLD.halfWidth + 5
      ) {
        s.projectiles.splice(i, 1);
        continue;
      }

      // Contact damage for non-flak projectiles.
      if (p.fuse === undefined) {
        let hit: EnemyMissile | null = null;
        let hitDist: number = TURRET.projectileHitRadius;
        for (const e of s.enemies) {
          if (e.phased) continue;
          const d = dist(p.pos, e.pos);
          if (d <= hitDist) {
            hit = e;
            hitDist = d;
          }
        }
        if (hit) {
          this.damageEnemy(hit, p.damage);
          s.projectiles.splice(i, 1);
        }
      }
    }
  }

  /** Apply damage to an enemy; on death remove it and award scrap.
   *  Shared by explosions, projectiles and instant-hit turrets. */
  private damageEnemy(enemy: EnemyMissile, dmg: number): void {
    const s = this.state;
    if (enemy.phased) return; // Phase Walker is invulnerable while phased
    if (enemy.kind === 'regenerator') enemy.regenTimer = 0; // interrupt healing
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      const index = s.enemies.indexOf(enemy);
      if (index >= 0) s.enemies.splice(index, 1);
      if (enemy.kind === 'splitter') {
        for (let i = 0; i < ENEMY.splitter.childCount; i++) this.spawnChild('swarmer', enemy, 1.6);
      }
      const reward = this.scaledScrap(enemy.scrapReward);
      s.scrap += reward;
      s.events.push({ type: 'enemyKilled', pos: { ...enemy.pos }, reward });
      if (enemy.kind === 'boss') {
        const cores = BOSS.coresBase + Math.floor(this.cfg.night / BOSS_NIGHT_INTERVAL);
        s.events.push({ type: 'bossKilled', cores });
      }
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
            this.damageEnemy(enemy, ex.damage);
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
    turrets: cfg.turrets.map((t, i) => ({
      id: i,
      kind: t.kind,
      level: t.level,
      x: TURRETS[t.kind].x,
      y: TURRET.y,
      cooldown: 0,
    })),
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
