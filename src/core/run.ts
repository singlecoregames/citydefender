import type { TreeLevels } from './tree';

/** Persistent meta-game state spanning many nights (the "run"). A single
 *  night's Sim is derived from this; this is what gets saved. */
export interface RunState {
  /** Current night number, 1-based. The night the player is about to play. */
  night: number;
  /** Spendable currency carried across nights. */
  scrap: number;
  /** Boss tokens (◆): 1 per boss kill, spent to unlock SPECIAL nodes
   *  (abilities, advanced turrets, tier specials — see tree unlockCores). */
  cores: number;
  /** Purchased skill-tree node levels by id. */
  upgrades: TreeLevels;
  /** Base seed; each night uses seed + night for its enemy RNG. */
  seed: number;
  /** Highest night the player has cleared (for stats / "best"). */
  bestNight: number;
  /** Consecutive defeats on the current night (drives the defeat-payout
   *  pity). Reset to 0 on victory. */
  failStreak: number;
}

export function newRun(seed = (Date.now() & 0xffffffff) >>> 0): RunState {
  return {
    night: 1,
    scrap: 0,
    cores: 0,
    // The command core is owned from the start so the branch roots unlock.
    upgrades: { core: 1 },
    seed,
    bestNight: 0,
    failStreak: 0,
  };
}

/** Per-night RNG seed derived from the run seed and night number. */
export function nightSeed(run: RunState): number {
  return (run.seed + run.night * 2654435761) >>> 0;
}
