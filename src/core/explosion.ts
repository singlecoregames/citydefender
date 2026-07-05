import { EXPLOSION } from './balance';
import type { Explosion } from './types';

export const EXPLOSION_TOTAL_SECONDS = EXPLOSION.holdSeconds + EXPLOSION.fadeSeconds;

/** Current blast radius: full size the instant it detonates, held briefly,
 *  then shrinking away to nothing. */
export function explosionRadius(e: Explosion): number {
  if (e.age <= EXPLOSION.holdSeconds) return e.maxRadius;
  const t = Math.min(1, (e.age - EXPLOSION.holdSeconds) / EXPLOSION.fadeSeconds);
  return e.maxRadius * (1 - t);
}

/** Explosions only deal damage at full radius, not while shrinking. */
export function explosionIsLethal(e: Explosion): boolean {
  return e.age <= EXPLOSION.holdSeconds;
}

export function explosionIsDone(e: Explosion): boolean {
  return e.age >= EXPLOSION_TOTAL_SECONDS;
}
