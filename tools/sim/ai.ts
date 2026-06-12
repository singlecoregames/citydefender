/**
 * Scripted "human" player for the balance simulator. Each tick it may fire
 * the manual cannon at the most urgent enemy (lead-aimed with the same
 * intercept math the sim uses, then jittered), rate-limited to approximate a
 * person, and it triggers owned abilities on simple panic/value heuristics.
 */
import { CANNON, EXPLOSION, TICK_RATE, WORLD } from '../../src/core/balance';
import { Rng } from '../../src/core/rng';
import type { NightConfig } from '../../src/core/sim';
import type { Command, EnemyMissile, GameState, Vec2 } from '../../src/core/types';

/** Time for a projectile at `speed` to meet a target moving at `vel`. */
function interceptTime(origin: Vec2, pos: Vec2, vel: Vec2, speed: number): number | null {
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;
  const a = vel.x * vel.x + vel.y * vel.y - speed * speed;
  const b = 2 * (dx * vel.x + dy * vel.y);
  const c = dx * dx + dy * dy;
  let t: number | null = null;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((r) => r > 0);
      if (roots.length > 0) t = Math.min(...roots);
    }
  }
  return t !== null && Number.isFinite(t) && t > 0 ? t : null;
}

export class NightAi {
  private readonly rng: Rng;
  private readonly cfg: NightConfig;
  /** Ticks between manual shots (human fire-rate cap). */
  private readonly shotInterval: number;
  /** Aim error in world units, shrinking with skill. */
  private readonly jitter: number;
  private fireCooldown = 0;
  private tick = 0;
  /** Damage already in flight toward an enemy, so we don't waste ammo. */
  private claims: { enemyId: number; damage: number; expiresTick: number }[] = [];

  constructor(seed: number, skill: number, cfg: NightConfig) {
    this.rng = new Rng(seed);
    this.cfg = cfg;
    this.shotInterval = Math.max(8, Math.round(TICK_RATE / (1.2 + 2.2 * skill)));
    this.jitter = 5 * (1 - skill);
  }

  /** Decide this tick's commands from the visible game state. */
  commands(state: GameState): Command[] {
    this.tick++;
    if (this.fireCooldown > 0) this.fireCooldown--;
    this.claims = this.claims.filter(
      (c) => c.expiresTick > this.tick && state.enemies.some((e) => e.id === c.enemyId),
    );

    const out: Command[] = [];
    this.useAbilities(state, out);

    if (this.fireCooldown <= 0 && state.cannon.ammo > 0) {
      const target = this.pickTarget(state);
      // Ammo discipline: with a near-empty magazine hold the last rounds for
      // genuine emergencies; with a full one it's fine to engage early.
      const engageY = state.cannon.ammo <= 2 ? 45 : state.cannon.ammo >= state.cannon.maxAmmo ? 95 : 85;
      if (target && target.pos.y < engageY) {
        out.push(this.planShot(state, target));
        this.fireCooldown = this.shotInterval;
      }
    }
    return out;
  }

  /** Most urgent enemy: lowest on screen, not phased, not already covered by
   *  enough in-flight damage. */
  private pickTarget(state: GameState): EnemyMissile | null {
    let best: EnemyMissile | null = null;
    for (const e of state.enemies) {
      if (e.pos.y > WORLD.height || e.pos.y < 8) continue; // off-screen / too low
      if (e.phased) continue;
      if (e.hp - this.pendingDamage(e.id) <= 0) continue;
      if (!best || e.pos.y < best.pos.y) best = e;
    }
    return best;
  }

  private pendingDamage(enemyId: number): number {
    let sum = 0;
    for (const c of this.claims) if (c.enemyId === enemyId) sum += c.damage;
    return sum;
  }

  /** Aim one shot at the urgent enemy, nudged toward the centroid of every
   *  enemy the blast can also catch — the multi-kill instinct that makes a
   *  six-round magazine survive a dense wave. */
  private planShot(state: GameState, target: EnemyMissile): Command {
    const origin: Vec2 = { x: CANNON.x, y: CANNON.y };
    const speed = this.cfg.stats.interceptorSpeed;
    const t = interceptTime(origin, target.pos, target.vel, speed) ?? 0.5;
    // Aim a hair ahead so the blast is mid-growth when the enemy arrives.
    const lead = t + EXPLOSION.growSeconds * 0.4;
    const at = (e: EnemyMissile): Vec2 => ({
      x: e.pos.x + e.vel.x * lead,
      y: e.pos.y + e.vel.y * lead,
    });

    // Everyone whose future position falls inside a blast centred near the
    // urgent enemy. Centroid-shift is capped so the urgent one always dies.
    const radius = this.cfg.stats.explosionMaxRadius;
    const anchor = at(target);
    const caught: EnemyMissile[] = [];
    let cx = 0;
    let cy = 0;
    for (const e of state.enemies) {
      if (e.phased || e.pos.y > WORLD.height) continue;
      const p = at(e);
      if (Math.hypot(p.x - anchor.x, p.y - anchor.y) <= radius * 1.5) {
        caught.push(e);
        cx += p.x;
        cy += p.y;
      }
    }
    const n = Math.max(1, caught.length);
    const shift = Math.min(1, (radius * 0.45) / Math.max(1e-6, Math.hypot(cx / n - anchor.x, cy / n - anchor.y)));
    const aim: Vec2 = {
      x: anchor.x + (cx / n - anchor.x) * shift + this.rng.range(-this.jitter, this.jitter),
      y: anchor.y + (cy / n - anchor.y) * shift + this.rng.range(-this.jitter, this.jitter),
    };
    aim.x = Math.max(-WORLD.halfWidth, Math.min(WORLD.halfWidth, aim.x));
    aim.y = Math.max(8, Math.min(WORLD.height, aim.y));

    const flight = Math.hypot(aim.x - origin.x, aim.y - origin.y) / speed;
    const expires =
      this.tick + Math.ceil((flight + EXPLOSION.growSeconds + EXPLOSION.holdSeconds) * TICK_RATE);
    for (const e of caught) {
      this.claims.push({ enemyId: e.id, damage: this.cfg.stats.explosionDamage, expiresTick: expires });
    }
    return { type: 'fire', x: aim.x, y: aim.y };
  }

  private useAbilities(state: GameState, out: Command[]): void {
    const a = this.cfg.abilities;
    const cd = state.ability.cooldown;
    const enemies = state.enemies;
    // EMP: panic button — something is about to land.
    if (a.emp > 0 && cd.emp <= 0 && enemies.some((e) => e.pos.y < 18)) {
      out.push({ type: 'ability', ability: 'emp' });
    }
    // Mega Bomb: value cast into a thick mid-field cluster.
    if (
      a.megabomb > 0 &&
      cd.megabomb <= 0 &&
      enemies.filter((e) => e.pos.y > 25 && e.pos.y < 60).length >= 4
    ) {
      out.push({ type: 'ability', ability: 'megabomb' });
    }
    // Time Dilation: the screen is crowded.
    if (a.slowmo > 0 && cd.slowmo <= 0 && enemies.length >= 8) {
      out.push({ type: 'ability', ability: 'slowmo' });
    }
    // Scrap Surge: enough targets on screen to profit from the window.
    if (a.surge > 0 && cd.surge <= 0 && enemies.length >= 5) {
      out.push({ type: 'ability', ability: 'surge' });
    }
  }
}
