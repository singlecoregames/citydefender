import { EXPLOSION } from './balance';
import type { Explosion } from './types';

export const EXPLOSION_TOTAL_SECONDS =
  EXPLOSION.growSeconds + EXPLOSION.holdSeconds + EXPLOSION.fadeSeconds;

/** Current blast radius for an explosion of a given age. */
export function explosionRadius(e: Explosion): number {
  if (e.age <= EXPLOSION.growSeconds) {
    return e.maxRadius * (e.age / EXPLOSION.growSeconds);
  }
  if (e.age <= EXPLOSION.growSeconds + EXPLOSION.holdSeconds) {
    return e.maxRadius;
  }
  const fadeAge = e.age - EXPLOSION.growSeconds - EXPLOSION.holdSeconds;
  const t = Math.min(1, fadeAge / EXPLOSION.fadeSeconds);
  return e.maxRadius * (1 - t);
}

/** Explosions only deal damage while growing or holding, not while fading. */
export function explosionIsLethal(e: Explosion): boolean {
  return e.age <= EXPLOSION.growSeconds + EXPLOSION.holdSeconds;
}

export function explosionIsDone(e: Explosion): boolean {
  return e.age >= EXPLOSION_TOTAL_SECONDS;
}
