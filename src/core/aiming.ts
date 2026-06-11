import type { Vec2 } from './types';

/**
 * Lead-aim solver: given a shooter at `origin`, a target at `targetPos` moving
 * with constant `targetVel`, and a projectile speed, find the unit direction
 * to fire so the projectile and target arrive at the same point.
 *
 * Solves |P + V·t - O| = s·t for the smallest positive t:
 *   (V·V - s²)t² + 2(D·V)t + D·D = 0,  D = P - O
 *
 * Returns null when no positive-time solution exists (target faster than the
 * projectile and receding) — callers should fall back to aiming directly.
 */
export function interceptDirection(
  origin: Vec2,
  targetPos: Vec2,
  targetVel: Vec2,
  projectileSpeed: number,
): Vec2 | null {
  const dx = targetPos.x - origin.x;
  const dy = targetPos.y - origin.y;
  const a = targetVel.x * targetVel.x + targetVel.y * targetVel.y - projectileSpeed * projectileSpeed;
  const b = 2 * (dx * targetVel.x + dy * targetVel.y);
  const c = dx * dx + dy * dy;

  let t: number;
  if (Math.abs(a) < 1e-9) {
    // Projectile speed ≈ target speed: linear equation.
    if (Math.abs(b) < 1e-9) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    t = Math.min(...[t1, t2].filter((x) => x > 0));
    if (!isFinite(t)) return null;
  }
  if (t <= 0) return null;

  const aimX = dx + targetVel.x * t;
  const aimY = dy + targetVel.y * t;
  const len = Math.hypot(aimX, aimY);
  if (len < 1e-9) return null;
  return { x: aimX / len, y: aimY / len };
}

/** Rotate a unit direction by `radians`. */
export function rotate(dir: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: dir.x * cos - dir.y * sin, y: dir.x * sin + dir.y * cos };
}
