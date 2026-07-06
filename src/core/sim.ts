/**
 * Headless game simulation for a single night. Fixed 60Hz timestep,
 * deterministic under a seed. No three.js or DOM imports allowed in this
 * directory — the renderer, the tests and the balance simulator all drive
 * this same code.
 */
import {
  ABILITIES,
  BOSS,
  BOSS_NIGHT_INTERVAL,
  BUILDING,
  BUILDING_TUNING,
  BUILDINGS,
  CANNON,
  CITY,
  COMBO,
  DATA,
  DT,
  ECONOMY,
  ENEMY,
  swarmerGroupFor,
  TURRET,
  TURRETS,
  WAVE_BREAK_SECONDS,
  WORLD,
} from './balance';
import { interceptDirection, rotate } from './aiming';
import { explosionIsDone, explosionIsLethal, explosionRadius } from './explosion';
import { Rng } from './rng';
import { baseStats, type DerivedStats } from './stats';
import type { AbilityLevels, BuildingSpec, TurretSpec } from './tree';
import type {
  AbilityKind,
  Building,
  City,
  Command,
  EnemyKind,
  EnemyMissile,
  GameEvent,
  GameState,
  Turret,
  TurretKind,
  Vec2,
} from './types';

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
  /** Deployed support buildings (kind + node level). */
  buildings: BuildingSpec[];
  /** Manual ability node levels (0 = not owned). */
  abilities: AbilityLevels;
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
    buildings: [],
    abilities: { emp: 0, megabomb: 0, slowmo: 0, surge: 0 },
    boss: night % BOSS_NIGHT_INTERVAL === 0,
  };
}

export class Sim {
  readonly state: GameState;
  private readonly rng: Rng;
  private readonly cfg: NightConfig;
  private bossNeedsSpawn: boolean;

  // Building-derived modifiers, resolved once per night (buildings are static).
  /** Aim-spread multiplier from the Radar Array (1 = no radar). */
  private readonly spreadMul: number;
  /** Jammer Tower slow field (null = not deployed). */
  private readonly jammerField: { x: number; y: number; radius: number; factor: number } | null;
  /** Decoy Beacon lure (null = not deployed). */
  private readonly decoyLure: { x: number; chance: number } | null;
  /** Estimated total turret damage/sec, the base for Overcharge Shot. */
  private readonly turretDps: number;

  constructor(seed: number, config: NightConfig = defaultNightConfig()) {
    this.rng = new Rng(seed);
    this.cfg = config;
    this.bossNeedsSpawn = config.boss;
    this.state = createInitialState(config);
    this.turretDps = estimateTurretDps(config);

    const radar = config.buildings.find((b) => b.kind === 'radar');
    this.spreadMul =
      (radar ? Math.pow(BUILDING_TUNING.radar.spreadMulPerLevel, radar.level) : 1) *
      config.stats.turretSpreadMul;
    const jammer = config.buildings.find((b) => b.kind === 'jammer');
    this.jammerField = jammer
      ? {
          x: BUILDINGS.jammer.x,
          y: BUILDING.y,
          radius: BUILDING_TUNING.jammer.radius * config.stats.jammerRadiusMul,
          factor:
            1 -
            (BUILDING_TUNING.jammer.slowBase +
              BUILDING_TUNING.jammer.slowPerLevel * (jammer.level - 1)),
        }
      : null;
    const decoy = config.buildings.find((b) => b.kind === 'decoy');
    this.decoyLure = decoy
      ? {
          x: BUILDINGS.decoy.x,
          chance:
            BUILDING_TUNING.decoy.pullBase +
            BUILDING_TUNING.decoy.pullPerLevel * (decoy.level - 1),
        }
      : null;
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
      else if (cmd.type === 'ability') this.useAbility(cmd.ability);
    }

    this.tickAbilities();
    this.regenAmmo();
    this.runDirector();
    this.updateEnemyBehavior();
    this.updateBuildings();
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

  // --- manual abilities (Tech branch) ---

  private tickAbilities(): void {
    const a = this.state.ability;
    a.cooldown.emp = Math.max(0, a.cooldown.emp - DT);
    a.cooldown.megabomb = Math.max(0, a.cooldown.megabomb - DT);
    a.cooldown.slowmo = Math.max(0, a.cooldown.slowmo - DT);
    a.cooldown.surge = Math.max(0, a.cooldown.surge - DT);
    a.empFreeze = Math.max(0, a.empFreeze - DT);
    a.slowmo = Math.max(0, a.slowmo - DT);
    a.surge = Math.max(0, a.surge - DT);
  }

  private useAbility(kind: AbilityKind): void {
    const s = this.state;
    const level = this.cfg.abilities[kind];
    if (level <= 0) return; // not owned
    if (s.ability.cooldown[kind] > 0) return; // still cooling down

    const cdMul = this.cfg.stats.abilityCooldownMul;
    if (kind === 'emp') {
      const spec = ABILITIES.emp;
      s.ability.empFreeze = spec.freeze + spec.freezePerLevel * (level - 1);
      s.ability.cooldown.emp =
        Math.max(spec.minCooldown, spec.baseCooldown - spec.cooldownPerLevel * (level - 1)) * cdMul;
      s.events.push({ type: 'abilityUsed', ability: 'emp' });
    } else if (kind === 'megabomb') {
      const spec = ABILITIES.megabomb;
      const pos: Vec2 = { x: 0, y: spec.y };
      s.explosions.push({
        id: s.nextId++,
        pos: { ...pos },
        age: 0,
        maxRadius: spec.radius + spec.radiusPerLevel * (level - 1),
        damage: spec.damage + spec.damagePerLevel * (level - 1),
        hitEnemyIds: [],
        source: 'ability',
      });
      s.ability.cooldown.megabomb =
        Math.max(spec.minCooldown, spec.baseCooldown - spec.cooldownPerLevel * (level - 1)) * cdMul;
      s.events.push({ type: 'abilityUsed', ability: 'megabomb', pos });
    } else if (kind === 'slowmo') {
      const spec = ABILITIES.slowmo;
      s.ability.slowmo = spec.duration + spec.durationPerLevel * (level - 1);
      s.ability.cooldown.slowmo =
        Math.max(spec.minCooldown, spec.baseCooldown - spec.cooldownPerLevel * (level - 1)) * cdMul;
      s.events.push({ type: 'abilityUsed', ability: 'slowmo' });
    } else {
      const spec = ABILITIES.surge;
      s.ability.surge = spec.duration + spec.durationPerLevel * (level - 1);
      s.ability.cooldown.surge =
        Math.max(spec.minCooldown, spec.baseCooldown - spec.cooldownPerLevel * (level - 1)) * cdMul;
      s.events.push({ type: 'abilityUsed', ability: 'surge' });
    }
  }

  /** Time multiplier applied to enemy motion/behaviour: 0 while EMP-frozen,
   *  slowmo factor while Time Dilation is active, else 1. */
  private enemyTimeScale(): number {
    if (this.state.ability.empFreeze > 0) return 0;
    if (this.state.ability.slowmo > 0) return ABILITIES.slowmo.factor;
    return 1;
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
      s.scrap += this.cfg.stats.waveClearScrap; // Wave Dividend payout
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
      const group = swarmerGroupFor(this.cfg.night);
      for (let i = 0; i < group; i++) this.spawnEnemy('swarmer', wave);
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
    if (this.decoyLure && this.rng.next() < this.decoyLure.chance) {
      // Decoy Beacon: lured enemies dive at the beacon, away from the cities.
      const j = BUILDING_TUNING.decoy.jitter;
      targetX = this.decoyLure.x + this.rng.range(-j, j);
    } else if (living.length > 0 && this.rng.next() < 0.7) {
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

  /** Per-tick special behaviour: phasing, regeneration, minion spawning.
   *  EMP/Time Dilation slow these timers too (frozen enemies don't act). */
  private updateEnemyBehavior(): void {
    const s = this.state;
    const dt = DT * this.enemyTimeScale();
    if (dt === 0) return; // fully frozen: no behaviour this tick
    for (const e of s.enemies) {
      switch (e.kind) {
        case 'boss': {
          // No hovering — the boss keeps descending; if it ever reaches the
          // ground the night is lost (see moveEnemies).
          e.spawnTimer! -= dt;
          if (e.spawnTimer! <= 0) {
            this.spawnChild('swarmer', e, 1.3);
            e.spawnTimer! += BOSS.spawnInterval;
          }
          break;
        }
        case 'phase': {
          e.phaseTimer! -= dt;
          if (e.phaseTimer! <= 0) {
            e.phased = !e.phased;
            e.phaseTimer = e.phased ? ENEMY.phase.phaseDuration : ENEMY.phase.phaseInterval;
          }
          break;
        }
        case 'regenerator': {
          e.regenTimer! += dt;
          if (e.regenTimer! >= ENEMY.regenerator.regenDelay && e.hp < e.maxHp) {
            e.hp = Math.min(e.maxHp, e.hp + ENEMY.regenerator.regenPerSec * dt);
          }
          break;
        }
        case 'carrier': {
          e.spawnTimer! -= dt;
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

  // --- support buildings (non-combat) ---

  /** Tick passive structures: Scrap Harvester income and Repair Bay healing.
   *  The Shield Generator has no per-tick work — it's consumed on impact. */
  private updateBuildings(): void {
    const s = this.state;
    for (const b of s.buildings) {
      if (b.kind === 'harvester') {
        b.accum += BUILDING_TUNING.harvester.scrapPerSecPerLevel * b.level * DT;
        if (b.accum >= 1) {
          const gained = Math.floor(b.accum);
          b.accum -= gained;
          s.scrap += gained;
        }
      } else if (b.kind === 'repair') {
        b.timer -= DT;
        if (b.timer <= 0) {
          const target = this.mostDamagedCity();
          if (target) {
            target.hp = Math.min(target.maxHp, target.hp + BUILDING_TUNING.repair.healAmount);
            s.events.push({ type: 'cityRepaired', cityId: target.id });
            b.timer = repairInterval(b.level);
          } else {
            b.timer = 0; // nothing to fix yet — stay ready for the next hit
          }
        }
      }
    }
  }

  /** The living city with the lowest non-full HP (deterministic tie-break). */
  private mostDamagedCity(): City | null {
    let best: City | null = null;
    for (const c of this.state.cities) {
      if (c.hp <= 0 || c.hp >= c.maxHp) continue;
      if (!best || c.hp < best.hp || (c.hp === best.hp && c.id < best.id)) best = c;
    }
    return best;
  }

  // --- automated turrets ---

  private updateTurrets(): void {
    for (const turret of this.state.turrets) {
      turret.cooldown -= DT;
      if (turret.cooldown > 0) continue;
      const spec = TURRETS[turret.kind];
      const range =
        spec.range *
        this.cfg.stats.turretRangeMul *
        (turret.kind === 'laser' ? this.cfg.stats.laserRangeMul : 1);
      const damage =
        spec.damage *
        (1 + TURRET.levelDamageBonus * (turret.level - 1)) *
        this.cfg.stats.turretDamageMul *
        kindDamageMul(turret.kind, this.cfg.stats);
      const fired = this.fireTurret(turret, range, damage);
      if (fired) {
        const rate =
          spec.fireRate *
          this.cfg.stats.turretFireRateMul *
          kindFireRateMul(turret.kind, this.cfg.stats);
        turret.cooldown += 1 / rate;
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
        this.damageEnemy(target, damage); // laserDamageMul already folded in
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
        const deg = spec.spreadDeg! * this.spreadMul;
        const spreadRad = (this.rng.range(-deg, deg) * Math.PI) / 180;
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

  /** Phased enemies are untouchable unless Doppler Tracking is owned. */
  private isUntouchable(e: EnemyMissile): boolean {
    return e.phased === true && this.cfg.stats.dopplerTracking <= 0;
  }

  /** Lead-aim at a moving target, then apply a random angular error (tightened
   *  by the Radar Array's spread multiplier). */
  private aimWithSpread(
    origin: Vec2,
    target: EnemyMissile,
    projectileSpeed: number,
    spreadDeg: number,
  ): Vec2 {
    const lead =
      interceptDirection(origin, target.pos, target.vel, projectileSpeed) ??
      norm({ x: target.pos.x - origin.x, y: target.pos.y - origin.y });
    const deg = spreadDeg * this.spreadMul;
    const spreadRad = (this.rng.range(-deg, deg) * Math.PI) / 180;
    return rotate(lead, spreadRad);
  }

  /** Threat Analysis: true when this enemy's projected ground impact would
   *  damage a living segment. Enemies climbing or hovering are non-threats. */
  private threatensCity(e: EnemyMissile): boolean {
    if (e.vel.y >= 0) return false;
    const t = (e.pos.y - CITY.groundTop) / -e.vel.y;
    if (t < 0) return false;
    const impactX = e.pos.x + e.vel.x * t;
    const seg = this.segmentAt(impactX);
    return !!seg && seg.hp > 0;
  }

  /** Pick the most-progressed (lowest) enemy within range — the biggest threat
   *  to the cities. With Threat Analysis, enemies that would actually hit a
   *  city outrank everything else. Deterministic tie-break by id keeps
   *  replays stable. */
  private selectTarget(origin: Vec2, range: number): EnemyMissile | null {
    const useThreat = this.cfg.stats.threatTargeting > 0;
    let best: EnemyMissile | null = null;
    let bestThreat = false;
    for (const e of this.state.enemies) {
      if (this.isUntouchable(e)) continue;
      if (dist(origin, e.pos) > range) continue;
      const threat = useThreat && this.threatensCity(e);
      if (
        !best ||
        (threat && !bestThreat) ||
        (threat === bestThreat &&
          (e.pos.y < best.pos.y || (e.pos.y === best.pos.y && e.id < best.id)))
      ) {
        best = e;
        bestThreat = threat;
      }
    }
    return best;
  }

  /** The `count` most-progressed enemies within range (for missile salvos),
   *  city-threatening enemies first when Threat Analysis is owned. */
  private selectTargets(origin: Vec2, range: number, count: number): EnemyMissile[] {
    const useThreat = this.cfg.stats.threatTargeting > 0;
    const threatRank = (e: EnemyMissile): number => (useThreat && this.threatensCity(e) ? 0 : 1);
    return this.state.enemies
      .filter((e) => !this.isUntouchable(e) && dist(origin, e.pos) <= range)
      .sort((a, b) => threatRank(a) - threatRank(b) || a.pos.y - b.pos.y || a.id - b.id)
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
            source: 'turret',
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
          if (this.isUntouchable(e)) continue;
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
   *  Shared by explosions, projectiles and instant-hit turrets.
   *  Returns true when the hit was lethal. */
  private damageEnemy(enemy: EnemyMissile, dmg: number): boolean {
    const s = this.state;
    if (this.isUntouchable(enemy)) return false; // phased & no Doppler Tracking
    if (enemy.kind === 'regenerator') enemy.regenTimer = 0; // interrupt healing
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      const index = s.enemies.indexOf(enemy);
      if (index >= 0) s.enemies.splice(index, 1);
      if (enemy.kind === 'splitter') {
        for (let i = 0; i < ENEMY.splitter.childCount; i++) this.spawnChild('swarmer', enemy, 1.6);
      }
      const reward = this.scaledScrap(enemy.scrapReward * this.comboScrapMul());
      s.scrap += reward;
      s.events.push({ type: 'enemyKilled', pos: { ...enemy.pos }, reward });
      if (enemy.kind === 'boss') {
        const cores = BOSS.coresBase + Math.floor(this.cfg.night / BOSS_NIGHT_INTERVAL);
        s.events.push({ type: 'bossKilled', cores });
      }
      return true;
    }
    return false;
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
          // Overcharge Shot: manual blasts ride on total turret DPS.
          damage: this.cfg.stats.explosionDamage + this.cfg.stats.overchargeRate * this.turretDps,
          hitEnemyIds: [],
          source: 'manual',
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
    const dt = DT * this.enemyTimeScale(); // EMP freezes, Time Dilation slows
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i]!;
      // Jammer Tower: extra slow while inside its field.
      const jam = this.jammerField;
      const edt = jam && dist(jam, e.pos) <= jam.radius ? dt * jam.factor : dt;
      e.pos.x += e.vel.x * edt;
      e.pos.y += e.vel.y * edt;
      // Enemies detonate on reaching the raised ground band; the segment
      // under the impact takes the damage. A boss touching down ends the
      // night outright, whichever segment it lands on.
      if (e.pos.y <= CITY.groundTop) {
        s.enemies.splice(i, 1);
        if (e.kind === 'boss') this.bossReachesGround(e);
        else this.handleGroundImpact(e);
      }
    }
  }

  /** The ground segment ("city") under a world x. */
  private segmentAt(x: number): City | undefined {
    const s = this.state;
    const w = (WORLD.halfWidth * 2) / s.cities.length;
    const idx = Math.min(
      s.cities.length - 1,
      Math.max(0, Math.floor((x + WORLD.halfWidth) / w)),
    );
    return s.cities[idx];
  }

  private handleGroundImpact(e: EnemyMissile): void {
    const s = this.state;
    s.events.push({ type: 'groundImpact', pos: { x: e.pos.x, y: e.pos.y } });
    const seg = this.segmentAt(e.pos.x);
    if (!seg || seg.hp <= 0) return; // dead ground: crater fx only

    // Shield Generator soaks the whole impact for one charge.
    const shield = s.buildings.find((b) => b.kind === 'shield');
    if (shield && shield.charges > 0) {
      shield.charges--;
      s.events.push({ type: 'shieldAbsorbed', cityId: seg.id });
      return;
    }

    seg.hp--;
    s.cityDamageTaken++;
    s.scrap += this.cfg.stats.cityHitScrap; // War Insurance compensation
    s.events.push({ type: 'cityHit', cityId: seg.id, destroyed: seg.hp <= 0 });
    this.breakCombo(); // taking damage breaks the streak
  }

  /** A boss touching the ground is an immediate total loss: every segment is
   *  flattened, which the end-of-tick check turns into the night's defeat. */
  private bossReachesGround(e: EnemyMissile): void {
    const s = this.state;
    s.events.push({ type: 'groundImpact', pos: { x: e.pos.x, y: e.pos.y } });
    for (const seg of s.cities) {
      if (seg.hp <= 0) continue;
      s.cityDamageTaken += seg.hp;
      seg.hp = 0;
      s.events.push({ type: 'cityHit', cityId: seg.id, destroyed: true });
    }
    this.breakCombo();
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
            if (this.damageEnemy(enemy, ex.damage)) {
              ex.kills = (ex.kills ?? 0) + 1;
              // Chain Bounty: one payout per explosion, on its 3rd kill.
              if (ex.kills === 3) s.scrap += this.cfg.stats.multiKillScrap;
              if (ex.source === 'manual') {
                s.combo++;
                s.maxCombo = Math.max(s.maxCombo, s.combo);
              }
            }
          }
        }
      }
      if (explosionIsDone(ex)) {
        // A manual blast that hit nothing is a whiff — the streak breaks.
        if (ex.source === 'manual' && (ex.kills ?? 0) === 0) this.breakCombo();
        s.explosions.splice(i, 1);
      }
    }
  }

  /** Drop the combo, keeping the Combo Memory fraction. */
  private breakCombo(): void {
    const s = this.state;
    if (s.combo === 0) return;
    const kept = Math.floor(s.combo * this.cfg.stats.comboRetention);
    s.events.push({ type: 'comboBroken', lost: s.combo - kept });
    s.combo = kept;
  }

  /** Global scrap multiplier from the current combo streak. */
  private comboScrapMul(): number {
    return 1 + COMBO.scrapPerStack * Math.min(this.state.combo, COMBO.maxStacks);
  }

  private scaledScrap(base: number): number {
    const surge = this.state.ability.surge > 0 ? ABILITIES.surge.factor : 1;
    return Math.max(1, Math.round(base * this.cfg.stats.scrapMul * surge));
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
    const dataEarned = outcome === 'victory' ? this.computeData() : 0;
    s.events.push({ type: 'nightEnded', outcome, scrapEarned: s.scrap, dataEarned });
  }

  /** Data (▣) payout for skilled play: perfect defence + peak combo.
   *  Only flows from DATA.unlockNight on — the late-game mastery currency. */
  private computeData(): number {
    const s = this.state;
    if (s.night < DATA.unlockNight) return 0;
    let data = 0;
    if (s.cityDamageTaken === 0) data += DATA.perfectBase + Math.floor(s.night / 10);
    data += Math.min(Math.floor(s.maxCombo / DATA.comboPerData), DATA.comboDataCap);
    return data;
  }
}

function createInitialState(cfg: NightConfig): GameState {
  return {
    tick: 0,
    night: cfg.night,
    phase: 'playing',
    outcome: null,
    cannon: { ammo: cfg.stats.maxAmmo, maxAmmo: cfg.stats.maxAmmo, reloadTimer: cfg.stats.reloadSeconds },
    // Ground segments ("cities"): equal slices of the full field width, each
    // with its own hp. Upgrades raise the count, splitting damage finer.
    cities: groundSegments(cfg.stats),
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
    buildings: cfg.buildings.map((b, i) => makeBuilding(i, b)),
    projectiles: [],
    scrap: 0,
    combo: 0,
    maxCombo: 0,
    cityDamageTaken: 0,
    ability: {
      cooldown: { emp: 0, megabomb: 0, slowmo: 0, surge: 0 },
      empFreeze: 0,
      slowmo: 0,
      surge: 0,
    },
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

/** Rough damage/sec across every deployed turret — the Overcharge Shot base.
 *  Uses each kind's nominal damage × fire rate with the global and per-kind
 *  multipliers; good enough for a bonus that should *feel* tied to firepower. */
function estimateTurretDps(cfg: NightConfig): number {
  let dps = 0;
  for (const t of cfg.turrets) {
    const spec = TURRETS[t.kind];
    const damage =
      spec.damage *
      (1 + TURRET.levelDamageBonus * (t.level - 1)) *
      cfg.stats.turretDamageMul *
      kindDamageMul(t.kind, cfg.stats);
    const rate = spec.fireRate * cfg.stats.turretFireRateMul * kindFireRateMul(t.kind, cfg.stats);
    dps += damage * rate;
  }
  return dps;
}

/** Per-kind damage multiplier from the turret specialisation nodes. */
function kindDamageMul(kind: TurretKind, stats: DerivedStats): number {
  switch (kind) {
    case 'gatling':
      return stats.gatlingDamageMul;
    case 'laser':
      return stats.laserDamageMul;
    case 'missile':
      return stats.missileDamageMul;
    case 'tesla':
      return stats.teslaDamageMul;
    default:
      return 1;
  }
}

/** Per-kind fire-rate multiplier from the turret specialisation nodes. */
function kindFireRateMul(kind: TurretKind, stats: DerivedStats): number {
  switch (kind) {
    case 'gatling':
      return stats.gatlingFireRateMul;
    case 'flak':
      return stats.flakFireRateMul;
    case 'railgun':
      return stats.railgunFireRateMul;
    default:
      return 1;
  }
}

/** Seconds between Repair Bay heals at a given level (shrinks to a floor). */
/** Build the night's ground segments: cityCount equal slices of the field,
 *  each with cityMaxHp. `x` is the segment centre (used by aiming/decoy). */
function groundSegments(stats: DerivedStats): City[] {
  const n = Math.max(1, Math.round(stats.cityCount));
  const w = (WORLD.halfWidth * 2) / n;
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: -WORLD.halfWidth + w * (i + 0.5),
    hp: stats.cityMaxHp,
    maxHp: stats.cityMaxHp,
  }));
}

function repairInterval(level: number): number {
  const t = BUILDING_TUNING.repair;
  return Math.max(t.intervalMin, t.intervalBase - t.intervalPerLevel * (level - 1));
}

/** Build a Building's initial runtime state from its deployed spec. */
function makeBuilding(id: number, spec: BuildingSpec): Building {
  const b: Building = {
    id,
    kind: spec.kind,
    level: spec.level,
    x: BUILDINGS[spec.kind].x,
    y: BUILDING.y,
    timer: 0,
    charges: 0,
    accum: 0,
  };
  if (spec.kind === 'shield') {
    const t = BUILDING_TUNING.shield;
    b.charges = t.chargesBase + t.chargesPerLevel * (spec.level - 1);
  } else if (spec.kind === 'repair') {
    b.timer = repairInterval(spec.level); // first heal after one full interval
  }
  return b;
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
