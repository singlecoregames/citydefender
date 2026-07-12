import type { GameEvent, GameState } from '../core/types';
import { zzfx, zzfxSetVolume, zzfxUnlock, type ZzfxSound } from './zzfx';

/**
 * Game SFX: an event consumer that sits next to the renderer (main.ts fans
 * the same GameEvent stream to both), plus a tiny per-frame update for the
 * few cues that are state transitions rather than events (reload click,
 * combo milestones). All sounds are ZzFX-procedural — zero audio assets.
 *
 * Mixing rules that keep 200 kills/night from becoming a hailstorm:
 *  - per-key throttle: a sound may not retrigger within its cooldown window
 *  - kill batching: all kills in one tick collapse into ONE pop, slightly
 *    louder per extra victim
 *  - combo pitch ladder: the kill pop climbs a semitone per combo stack
 *    (capped at an octave) and drops back when the streak breaks — the
 *    combo is audible without looking at the meter
 */

/** Master loudness when unmuted (zzfx convention keeps this well below 1). */
const MASTER_VOLUME = 0.5;
const MUTE_KEY = 'citydefender-muted';

// ZzFX parameter order, for reading the table below:
// [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
//  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, ...]
// shapes: 0 sin, 1 triangle, 2 saw, 3 tan(buzz), 4 noise-ish
const SOUNDS = {
  /** Cannon shot: short sine thump sliding down — a launch, not the impact. */
  fire: [0.4, 0.1, 130, 0.001, 0.03, 0.13, 0, 1.6, -9],
  /** Interceptor/flak blast: noisy boom, the core "I did damage" sound. */
  detonation: [0.5, 0.2, 90, 0.01, 0.05, 0.32, 4, 1.6, , , , , , 1.2],
  /** Kill pop: bright triangle blip; frequency is scaled by the combo ladder. */
  kill: [0.35, 0.05, 340, , 0.015, 0.07, 1, 1.5, , , , , , , , , , 0.9, 0.01],
  /** Static field pulse: buzzy electric zap. */
  fieldPulse: [0.22, 0.15, 850, , 0.015, 0.07, 3, 1.3],
  /** A city segment took the hit: heavy noise boom + descending alarm tail. */
  cityHitBoom: [0.65, 0.2, 55, 0.01, 0.09, 0.5, 4, 2, , , , , , 1.5],
  cityHitAlarm: [0.4, 0.05, 520, 0.02, 0.12, 0.3, 2, 1, -14],
  /** Impact on already-dead ground: just a dull thud. */
  groundImpact: [0.2, 0.2, 70, 0.01, 0.03, 0.18, 4, 1.4],
  /** Boss horn: low saw swelling in, with a slow tremolo. */
  bossSpawned: [0.55, 0.02, 62, 0.15, 0.4, 0.45, 2, 1.3, , , , , 0.14, , , , , 1, , 0.4],
  /** Boss kill fanfare: two rising pitch jumps. */
  bossKilled: [0.65, 0.05, 220, 0.02, 0.24, 0.5, 1, 1.7, , , 165, 0.11],
  victory: [0.55, , 392, 0.03, 0.28, 0.5, 1, 1.4, , , 196, 0.15],
  defeat: [0.55, , 200, 0.03, 0.3, 0.7, 2, 1.2, -3, , -95, 0.22],
  /** Turret beams, one voice per kind. */
  laser: [0.1, 0.05, 1400, , 0.012, 0.03, , 2],
  railgun: [0.35, 0.1, 1100, , 0.012, 0.13, 4, 2, -28, , , , , 0.6],
  tesla: [0.25, 0.2, 320, , 0.02, 0.08, 4, 1.3, , , , , 0.03, 2],
  lance: [0.5, 0.1, 180, 0.02, 0.15, 0.4, 2, 1.5, -8, , , , , 0.5],
  /** Abilities. */
  emp: [0.5, , 720, 0.05, 0.2, 0.4, , 1.5, -26],
  megabomb: [0.7, 0.2, 48, 0.02, 0.16, 0.75, 4, 2.4, , , , , , 1.8],
  freefire: [0.4, 0.05, 300, , 0.05, 0.15, 1, 1.2, 14],
  surge: [0.35, 0.05, 980, 0.02, 0.18, 0.3, 1, 1.5, , , 110, 0.08],
  /** Defenses soaking a hit. */
  shieldAbsorbed: [0.45, 0.1, 850, , 0.03, 0.25, , 2.5],
  aegisAbsorbed: [0.3, 0.1, 720, , 0.02, 0.12, 3, 1.5],
  /** Enemy tells. */
  mirvSplit: [0.35, 0.1, 420, , 0.012, 0.1, 4, 1.5, 6],
  healPulse: [0.25, , 260, 0.03, 0.12, 0.22, 1, 1, , , -70, 0.1],
  /** Player-state cues. */
  comboBroken: [0.35, , 180, 0.01, 0.08, 0.25, 2, 1, -8],
  comboMilestone: [0.4, , 660, 0.01, 0.1, 0.2, 1, 1.5, , , 132, 0.07],
  waveStarted: [0.12, , 520, , 0.012, 0.04, 1, 1],
  noAmmo: [0.22, , 140, , 0.012, 0.05, , 0.6],
  reloaded: [0.16, , 700, , 0.012, 0.035, 1, 1],
  purchase: [0.45, , 660, 0.02, 0.12, 0.25, 1, 1.6, , , 120, 0.1],
} satisfies Record<string, ZzfxSound>;

type SoundKey = keyof typeof SOUNDS;

/** Minimum ms between retriggers per key (defaults to 45ms). The big one-off
 *  moments are exempt; the spammy per-shot voices get wider windows. */
const THROTTLE_MS: Partial<Record<SoundKey, number>> = {
  fire: 60,
  detonation: 70,
  laser: 90,
  railgun: 80,
  tesla: 80,
  fieldPulse: 60,
  waveStarted: 300,
  noAmmo: 150,
  groundImpact: 90,
  healPulse: 120,
  cityHitBoom: 0,
  cityHitAlarm: 0,
  bossSpawned: 0,
  bossKilled: 0,
  victory: 0,
  defeat: 0,
};

/** Combo stacks are audible one semitone at a time, up to one octave. */
const LADDER_SEMITONES = 12;

export class AudioSystem {
  private muted: boolean;
  private lastPlayed = new Map<SoundKey, number>();
  private prevAmmo = Infinity;
  private prevCombo = 0;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    zzfxSetVolume(this.muted ? 0 : MASTER_VOLUME);
  }

  /** Resume/create the AudioContext. Call from any user-gesture handler. */
  unlock(): void {
    zzfxUnlock();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    zzfxSetVolume(muted ? 0 : MASTER_VOLUME);
  }

  /** Consume one tick's events (called right next to renderer.onEvents). */
  onEvents(events: readonly GameEvent[], state: GameState): void {
    if (this.muted || events.length === 0) return;
    // Kill batching: N kills this tick -> one pop, a touch louder per extra.
    let kills = 0;
    let bossDied = false;
    for (const ev of events) {
      switch (ev.type) {
        case 'fired':
          this.play('fire');
          break;
        case 'detonation':
          this.play('detonation');
          break;
        case 'enemyKilled':
          kills++;
          if (ev.kind === 'boss') bossDied = true;
          break;
        case 'fieldPulse':
          this.play('fieldPulse');
          break;
        case 'cityHit':
          this.play('cityHitBoom');
          this.play('cityHitAlarm');
          break;
        case 'groundImpact':
          this.play('groundImpact');
          break;
        case 'bossSpawned':
          this.play('bossSpawned');
          break;
        case 'bossKilled':
          this.play('bossKilled');
          break;
        case 'nightEnded':
          this.play(ev.outcome === 'victory' ? 'victory' : 'defeat');
          break;
        case 'beam':
          this.play(ev.kind);
          break;
        case 'abilityUsed':
          this.play(ev.ability);
          break;
        case 'shieldAbsorbed':
          this.play('shieldAbsorbed');
          break;
        case 'aegisAbsorbed':
          this.play('aegisAbsorbed');
          break;
        case 'mirvSplit':
          this.play('mirvSplit');
          break;
        case 'healPulse':
          this.play('healPulse');
          break;
        case 'comboBroken':
          // Only a streak worth mourning gets the sad slide.
          if (ev.lost >= 5) this.play('comboBroken');
          break;
        case 'waveStarted':
          this.play('waveStarted');
          break;
        case 'fireDenied':
          if (ev.reason === 'noAmmo') this.play('noAmmo');
          break;
      }
    }
    if (kills > 0 && !bossDied) {
      // The pitch ladder: combo stacks push the pop up a semitone each.
      const step = Math.min(state.combo, LADDER_SEMITONES);
      const pitch = Math.pow(2, step / LADDER_SEMITONES);
      const volume = 1 + Math.min(0.6, 0.12 * (kills - 1));
      this.play('kill', { pitch, volume });
    }
  }

  /** Per-frame state cues that have no event: the magazine refilling to full
   *  and the combo meter crossing a milestone. */
  update(state: GameState): void {
    if (this.muted) {
      this.prevAmmo = state.cannon.ammo;
      this.prevCombo = state.combo;
      return;
    }
    if (state.cannon.ammo === state.cannon.maxAmmo && this.prevAmmo < state.cannon.maxAmmo) {
      this.play('reloaded');
    }
    this.prevAmmo = state.cannon.ammo;
    for (const milestone of [10, 25, 50]) {
      if (this.prevCombo < milestone && state.combo >= milestone) this.play('comboMilestone');
    }
    this.prevCombo = state.combo;
  }

  /** Day-screen purchase chime (hooked from the shop callback, not an event). */
  playPurchase(): void {
    if (!this.muted) this.play('purchase');
  }

  private play(key: SoundKey, opts: { pitch?: number; volume?: number } = {}): void {
    const now = performance.now();
    const gap = THROTTLE_MS[key] ?? 45;
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < gap) return;
    this.lastPlayed.set(key, now);
    const params = SOUNDS[key] as ZzfxSound;
    if (opts.pitch && opts.pitch !== 1) {
      const scaled = params.slice();
      scaled[2] = (scaled[2] ?? 220) * opts.pitch;
      zzfx(scaled, opts.volume ?? 1);
    } else {
      zzfx(params, opts.volume ?? 1);
    }
  }
}
