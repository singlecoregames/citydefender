import { FIRST_CLEAR, prestigePoints } from './balance';
import type { PrestigeLevels } from './prestige';
import { HEAD_START_SCRAP_PER_LEVEL } from './prestige';
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
  /** Consecutive defeats on the current night (drives the defeat-payout
   *  pity). Reset to 0 on victory. */
  failStreak: number;
  /** Times this save has prestiged (drives enemy volume scaling). */
  prestige: number;
  /** Prestige point (✦) bank, spent on permanent upgrades. */
  pp: number;
  /** Permanent prestige upgrade levels by id — survive every reset. */
  prestigeUpgrades: PrestigeLevels;
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
    failStreak: 0,
    prestige: 0,
    pp: 0,
    prestigeUpgrades: {},
  };
}

/** Perform a prestige: bank the points for the depth reached, then reset the
 *  run to night 1 with a fresh seed — keeping only the prestige state. */
export function doPrestige(run: RunState): RunState {
  const fresh = newRun();
  fresh.prestige = run.prestige + 1;
  fresh.pp = run.pp + prestigePoints(run.bestNight);
  fresh.prestigeUpgrades = { ...run.prestigeUpgrades };
  fresh.scrap = HEAD_START_SCRAP_PER_LEVEL * (fresh.prestigeUpgrades['head_start'] ?? 0);
  return fresh;
}

/** Per-night RNG seed derived from the run seed and night number. */
export function nightSeed(run: RunState): number {
  return (run.seed + run.night * 2654435761) >>> 0;
}

/** Compound Interest node: bonus scrap paid at dawn on the unspent bank. */
export function dawnInterest(scrap: number, rate: number): number {
  return rate > 0 ? Math.floor(scrap * rate) : 0;
}

/** Cores paid for clearing `night` for the first time (0 before fromNight). */
export function firstClearCores(night: number): number {
  if (night < FIRST_CLEAR.fromNight) return 0;
  return FIRST_CLEAR.base + Math.floor(night / FIRST_CLEAR.scaleNights);
}
