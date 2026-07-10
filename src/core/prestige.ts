import type { Vec2 } from './types';

/**
 * Combat specs for the tier-2 visual upgrades that came out of the old
 * reset-prestige system (the nodes themselves live in core/tree.ts now).
 */
export type { Vec2 };

/** Per-drone combat spec (drones are permanent mini-gatlings on orbit). */
export const DRONE = {
  fireRate: 0.9,
  damage: 1,
  range: 45,
  projectileSpeed: 85,
  /** Orbit centre sits this far above the ground, radius around it. */
  orbitY: 22,
  orbitRadius: 11,
  /** Radians per second the escort ring turns. */
  orbitSpeed: 1.1,
} as const;

/** MIRV: submunitions per level, at this fraction of the main blast radius,
 *  landing this far to each side of the aim point. */
export const MIRV = { splitsPerLevel: 2, radiusFrac: 0.55, offsetFrac: 1.35 } as const;

/** Orbital Lance (tier 4): every `interval − perLevel×(lvl−1)` seconds a
 *  sky-wide beam slams the densest enemy column. Damage rides the global
 *  turret damage multiplier so it keeps up with Arsenal Core. */
export const LANCE = {
  interval: 11,
  intervalPerLevel: 1.5,
  damage: 12,
  /** Enemies within this horizontal distance of the strike take the hit. */
  width: 9,
} as const;

/** Aegis Dome (tier 4): a visible shell over the field; enemies (not bosses)
 *  that touch it are vaporised, spending one charge each. Charges refresh
 *  each night. Shell height above the ground at x=0; it follows an ellipse
 *  to the field edges. */
export const AEGIS = { height: 42 } as const;

/** Dome shell height at a given x (0 at the field edges). */
export function aegisDomeY(x: number, halfWidth: number, groundTop: number): number {
  const t = 1 - (x / halfWidth) ** 2;
  return t <= 0 ? groundTop : groundTop + AEGIS.height * Math.sqrt(t);
}
