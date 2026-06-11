export interface Vec2 {
  x: number;
  y: number;
}

export interface City {
  id: number;
  x: number;
  hp: number;
  maxHp: number;
}

/** A player shot in flight toward its detonation point. */
export interface Interceptor {
  id: number;
  pos: Vec2;
  origin: Vec2;
  target: Vec2;
  speed: number;
}

export type TurretKind = 'gatling' | 'flak' | 'laser' | 'missile' | 'railgun' | 'tesla';

/** A fixed automated turret that targets and fires at enemies on its own.
 *  Each kind lives at its own predetermined position. */
export interface Turret {
  id: number;
  kind: TurretKind;
  /** Node level of this turret's tree node (scales its damage). */
  level: number;
  x: number;
  y: number;
  /** Seconds until it can fire again. */
  cooldown: number;
}

/** A physical projectile fired by a turret (gatling, flak, missile). */
export interface TurretProjectile {
  id: number;
  kind: TurretKind;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  /** Seconds until self-destruction (safety net for homing shots). */
  ttl: number;
  /** Flak: seconds until the shell bursts into a small explosion. */
  fuse?: number;
  /** Flak: burst explosion radius. */
  burstRadius?: number;
  /** Missile: enemy id this shot is homing onto. */
  targetId?: number;
}

export type ExplosionPhase = 'grow' | 'hold' | 'fade';

export interface Explosion {
  id: number;
  pos: Vec2;
  age: number;
  maxRadius: number;
  damage: number;
  /** Enemies already damaged by this explosion (damage once per explosion). */
  hitEnemyIds: number[];
}

export type EnemyKind =
  | 'ballistic'
  | 'swarmer'
  | 'splitter'
  | 'regenerator'
  | 'phase'
  | 'carrier'
  | 'boss';

export interface EnemyMissile {
  id: number;
  kind: EnemyKind;
  pos: Vec2;
  /** Spawn point, kept so the renderer can draw the full trail line. */
  origin: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  scrapReward: number;
  /** Phase Walker: toggles untargetable/invulnerable on a timer. */
  phased?: boolean;
  phaseTimer?: number;
  /** Regenerator: seconds since last damaged (heals once past the delay). */
  regenTimer?: number;
  /** Carrier: seconds until it sheds another swarmer. */
  spawnTimer?: number;
}

/** One-shot occurrences emitted during a tick, consumed by render/audio. */
export type GameEvent =
  | { type: 'fired'; target: Vec2 }
  | { type: 'fireDenied'; reason: 'noAmmo' | 'tooClose' }
  | { type: 'detonation'; pos: Vec2 }
  /** Instant-hit visuals: laser/railgun lines, tesla chain polyline. */
  | { type: 'beam'; kind: 'laser' | 'railgun' | 'tesla'; points: Vec2[] }
  | { type: 'enemyKilled'; pos: Vec2; reward: number }
  | { type: 'groundImpact'; pos: Vec2 }
  | { type: 'cityHit'; cityId: number; destroyed: boolean }
  | { type: 'waveStarted'; waveIndex: number }
  | { type: 'bossSpawned' }
  | { type: 'bossKilled'; cores: number }
  | { type: 'nightEnded'; outcome: 'victory' | 'defeat'; scrapEarned: number };

export type Command = { type: 'fire'; x: number; y: number };

export type NightPhase = 'playing' | 'ended';

export interface GameState {
  tick: number;
  /** Night number being played (for HUD/display). */
  night: number;
  phase: NightPhase;
  outcome: 'victory' | 'defeat' | null;
  cannon: {
    ammo: number;
    maxAmmo: number;
    /** Seconds until the next round regenerates. */
    reloadTimer: number;
  };
  cities: City[];
  interceptors: Interceptor[];
  explosions: Explosion[];
  enemies: EnemyMissile[];
  turrets: Turret[];
  projectiles: TurretProjectile[];
  scrap: number;
  /** Wave director state. */
  director: {
    waveIndex: number;
    totalWaves: number;
    spawnedInWave: number;
    /** Seconds until the next spawn (or next wave when in a break). */
    timer: number;
    inBreak: boolean;
    done: boolean;
  };
  nextId: number;
  /** Events emitted by the most recent step(); cleared at the start of each step. */
  events: GameEvent[];
}
