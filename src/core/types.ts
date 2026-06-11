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

export interface EnemyMissile {
  id: number;
  kind: 'ballistic';
  pos: Vec2;
  /** Spawn point, kept so the renderer can draw the full trail line. */
  origin: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  scrapReward: number;
}

/** One-shot occurrences emitted during a tick, consumed by render/audio. */
export type GameEvent =
  | { type: 'fired'; target: Vec2 }
  | { type: 'fireDenied'; reason: 'noAmmo' | 'tooClose' }
  | { type: 'detonation'; pos: Vec2 }
  | { type: 'enemyKilled'; pos: Vec2; reward: number }
  | { type: 'groundImpact'; pos: Vec2 }
  | { type: 'cityHit'; cityId: number; destroyed: boolean }
  | { type: 'waveStarted'; waveIndex: number }
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
