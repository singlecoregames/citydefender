import { FIRST_CLEAR } from './balance';
import type { TreeLevels } from './tree';

/** Persistent meta-game state spanning many nights (the "run"). A single
 *  night's Sim is derived from this; this is what gets saved. */
export interface RunState {
  /** Current night number, 1-based. The night the player is about to play. */
  night: number;
  /** Spendable currency carried across nights. */
  scrap: number;
  /** Rare currency from bosses; gates the strongest nodes. */
  cores: number;
  /** Skilled-play currency (perfect nights, combos); buys automation
   *  intelligence. Flows from DATA.unlockNight on. */
  data: number;
  /** Purchased skill-tree node levels by id. */
  upgrades: TreeLevels;
  /** Base seed; each night uses seed + night for its enemy RNG. */
  seed: number;
  /** Highest night the player has cleared (for stats / "best"). */
  bestNight: number;
}

export function newRun(seed = (Date.now() & 0xffffffff) >>> 0): RunState {
  return {
    night: 1,
    scrap: 0,
    cores: 0,
    data: 0,
    // The command core is owned from the start so the branch roots unlock.
    upgrades: { core: 1 },
    seed,
    bestNight: 0,
  };
}

/** Per-night RNG seed derived from the run seed and night number. */
export function nightSeed(run: RunState): number {
  return (run.seed + run.night * 2654435761) >>> 0;
}

/** Compound Interest node: bonus scrap paid at dawn on the unspent bank,
 *  capped at that night's earnings — an uncapped percentage compounds the
 *  bank into absurdity once the tree has nothing left to sell (sim: ×114
 *  over the back half of a run). */
export function dawnInterest(scrap: number, rate: number, nightEarnings: number): number {
  if (rate <= 0) return 0;
  return Math.min(Math.floor(scrap * rate), Math.max(0, nightEarnings));
}

/** Cores paid for clearing `night` for the first time (0 before fromNight). */
export function firstClearCores(night: number): number {
  if (night < FIRST_CLEAR.fromNight) return 0;
  return FIRST_CLEAR.base + Math.floor(night / FIRST_CLEAR.scaleNights);
}
