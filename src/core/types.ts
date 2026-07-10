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
  /** Fired by idle auto-fire, not the player (its blast skips the combo meter). */
  auto?: boolean;
}

export type TurretKind = 'gatling' | 'flak' | 'laser' | 'missile' | 'railgun' | 'tesla';

/** Non-combat support structures. Unlike turrets they never fire — each helps
 *  the cities passively (income, shielding, repairs, targeting, area denial). */
export type BuildingKind = 'harvester' | 'shield' | 'repair' | 'radar' | 'jammer' | 'decoy';

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

/** A deployed support building. Which runtime field matters depends on kind:
 *  harvester→accum (fractional scrap bank), shield→charges (impacts left to
 *  absorb this night), repair→timer (seconds until the next heal). */
export interface Building {
  id: number;
  kind: BuildingKind;
  /** Tree-node level (scales the building's effect). */
  level: number;
  x: number;
  y: number;
  timer: number;
  charges: number;
  accum: number;
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
  /** Enemies this explosion has killed (Chain Bounty pays out at 3). */
  kills?: number;
  /** What spawned it. Only 'manual' blasts feed (or break) the combo meter;
   *  'auto' is the idle auto-fire — cannon shots outside the player's hands. */
  source?: 'manual' | 'auto' | 'turret' | 'ability';
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
  | { type: 'beam'; kind: 'laser' | 'railgun' | 'tesla' | 'lance'; points: Vec2[] }
  | { type: 'enemyKilled'; pos: Vec2; reward: number }
  | { type: 'groundImpact'; pos: Vec2 }
  | { type: 'cityHit'; cityId: number; destroyed: boolean }
  /** A Shield Generator soaked a ground impact that would have hit a city. */
  | { type: 'shieldAbsorbed'; cityId: number }
  /** A Repair Bay restored a point of city HP. */
  | { type: 'cityRepaired'; cityId: number }
  /** The Aegis Dome soaked an enemy that touched its shell. */
  | { type: 'aegisAbsorbed'; pos: Vec2 }
  | { type: 'waveStarted'; waveIndex: number }
  | { type: 'bossSpawned' }
  | { type: 'bossKilled'; cores: number }
  | { type: 'abilityUsed'; ability: AbilityKind; pos?: Vec2 }
  /** The combo streak broke (whiffed manual blast or a city took damage). */
  | { type: 'comboBroken'; lost: number }
  | { type: 'nightEnded'; outcome: 'victory' | 'defeat'; scrapEarned: number; dataEarned: number };

export type Command =
  | { type: 'fire'; x: number; y: number }
  | { type: 'ability'; ability: AbilityKind };

export type AbilityKind = 'emp' | 'megabomb' | 'freefire' | 'surge';

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
    /** Seconds the magazine has sat full with no player input; drives the
     *  idle auto-fire (and its HUD gauge). A manual shot resets it. */
    idleSeconds: number;
    /** Idle seconds needed to arm the auto-fire; 0 = the node isn't owned
     *  (no auto-fire, and the HUD hides the gauge). */
    autoFireThreshold: number;
  };
  cities: City[];
  interceptors: Interceptor[];
  explosions: Explosion[];
  enemies: EnemyMissile[];
  turrets: Turret[];
  buildings: Building[];
  projectiles: TurretProjectile[];
  /** Escort drones orbiting the cannon (positions re-computed each tick
   *  from the orbit; empty when the upgrade isn't owned). */
  drones: Vec2[];
  /** Aegis Dome charges left this night (0 = no dome / spent). */
  aegisCharges: number;
  scrap: number;
  /** Combo meter: current streak of manual-explosion kills (global scrap
   *  multiplier) and the night's peak (pays out Data at dawn). */
  combo: number;
  maxCombo: number;
  /** Total city HP lost this night (0 = perfect defence → Data bonus). */
  cityDamageTaken: number;
  /** Manual ability state (Tech branch). Cooldowns count down to 0 (ready);
   *  the two timers are how long the active effects last. */
  ability: {
    cooldown: { emp: number; megabomb: number; freefire: number; surge: number };
    /** Enemies frozen (EMP) for this many more seconds. */
    empFreeze: number;
    /** Manual shots free (Free Fire: no ammo drain) for this many more seconds. */
    freefire: number;
    /** Scrap earnings doubled (Scrap Surge) for this many more seconds. */
    surge: number;
  };
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
