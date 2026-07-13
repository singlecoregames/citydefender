/**
 * Day-phase purchase strategies for the balance simulator. Mirrors the Day
 * screen's buy rules (unlock prerequisites, per-currency banks, level caps)
 * and spends every dawn until nothing is affordable.
 */
import { worldOf } from '../../src/core/balance';
import type { RunState } from '../../src/core/run';
import {
  getNode,
  isUnlocked,
  missingRequirement,
  nextPrice,
  reqId,
  TREE,
  type Currency,
  type NodePrice,
  type TreeBranch,
  type TreeNode,
} from '../../src/core/tree';

export type StrategyName = 'smart' | 'greedy' | 'economy' | 'automation' | 'cannon';

export const STRATEGIES: readonly StrategyName[] = [
  'smart',
  'greedy',
  'economy',
  'automation',
  'cannon',
];

/** Branch a focused strategy buys first when it can. */
const FOCUS: Partial<Record<StrategyName, TreeBranch>> = {
  economy: 'economy',
  automation: 'automation',
  cannon: 'cannon',
};

interface Candidate {
  node: TreeNode;
  price: NodePrice;
}

function bank(run: RunState, currency: Currency): number {
  return currency === 'cores' ? run.cores : run.scrap;
}

function pay(run: RunState, price: NodePrice): void {
  if (price.currency === 'cores') run.cores -= price.amount;
  else run.scrap -= price.amount;
}

function affordable(run: RunState): Candidate[] {
  const out: Candidate[] = [];
  for (const node of TREE) {
    if (node.branch === 'core') continue;
    if (!isUnlocked(node, run.upgrades, worldOf(run.night))) continue;
    const price = nextPrice(node, run.upgrades[node.id] ?? 0);
    if (price === null || bank(run, price.currency) < price.amount) continue;
    out.push({ node, price });
  }
  return out;
}

/** Cheapest first; ties broken by id so runs stay reproducible. */
function cheapest(cands: Candidate[]): Candidate {
  return cands.reduce((a, b) =>
    b.price.amount < a.price.amount ||
    (b.price.amount === a.price.amount && b.node.id < a.node.id)
      ? b
      : a,
  );
}

function buy(run: RunState, pick: Candidate, bought: string[]): void {
  pay(run, pick.price);
  run.upgrades[pick.node.id] = (run.upgrades[pick.node.id] ?? 0) + 1;
  bought.push(pick.node.id);
}

/** The order a player spends boss tokens (◆) on special unlocks — the early
 *  wave-clearers first, spectacle last. Only unlockable (prereqs met, world
 *  reached) entries are considered, so the list is a preference, not a plan. */
const CORES_PRIORITY: readonly string[] = [
  'ability_megabomb',
  'turret_tesla', // the anti-swarm/carrier turret — before more buttons
  'ability_emp',
  'arsenal_core', // the damage multiplier: first pick the moment world 2 opens
  'drone_escort',
  'ability_freefire',
  'turret_railgun',
  'mirv_warhead',
  'ability_surge',
  'orbital_lance',
  'aegis_dome',
];

/** Spend boss tokens on the highest-priority unlockable special. */
function spendCores(run: RunState, bought: string[]): void {
  for (;;) {
    const pick = CORES_PRIORITY.map((id) => getNode(id)!)
      .filter((node) => isUnlocked(node, run.upgrades, worldOf(run.night)))
      .map((node) => ({ node, price: nextPrice(node, run.upgrades[node.id] ?? 0) }))
      .find(
        (c): c is Candidate =>
          c.price !== null &&
          c.price.currency === 'cores' &&
          bank(run, 'cores') >= c.price.amount,
      );
    if (!pick) return;
    buy(run, pick, bought);
  }
}

/** The repeatable sink node: it never competes with content. A player buys
 *  the new toy before +2% filler; the sink gets the scrap surplus. */
const SINK_ID = 'war_effort';

/** Cheapest NEXT scrap price among unlocked, unmaxed content nodes — the
 *  amount worth saving toward — or null when the scrap tree is bought out. */
function nextContentGoal(run: RunState): number | null {
  let min: number | null = null;
  for (const node of TREE) {
    if (node.branch === 'core' || node.id === SINK_ID) continue;
    if (!isUnlocked(node, run.upgrades, worldOf(run.night))) continue;
    const price = nextPrice(node, run.upgrades[node.id] ?? 0);
    if (price === null || price.currency !== 'scrap') continue;
    if (min === null || price.amount < min) min = price.amount;
  }
  return min;
}

/** Greedy SCRAP spend: content cheapest-first; the sink only eats what's
 *  left over beyond the next content goal (so saving toward big nodes still
 *  happens — and a player walled with a bought-out tree dumps everything
 *  into it). Cores go through spendCores, never here. */
function greedySpend(run: RunState, bought: string[], focus?: TreeBranch): void {
  for (;;) {
    const cands = affordable(run).filter((c) => c.price.currency === 'scrap');
    const content = cands.filter((c) => c.node.id !== SINK_ID);
    if (content.length > 0) {
      const inFocus = focus ? content.filter((c) => c.node.branch === focus) : [];
      buy(run, cheapest(inFocus.length > 0 ? inFocus : content), bought);
      continue;
    }
    const sink = cands.find((c) => c.node.id === SINK_ID);
    if (!sink) break;
    const goal = nextContentGoal(run);
    if (goal !== null && bank(run, 'scrap') - sink.price.amount < goal) break;
    buy(run, sink, bought);
  }
}

/** The 'smart' strategy beelines these milestones in order, *saving* scrap
 *  for the next one instead of nickel-and-diming the cheap nodes — the way a
 *  player rushes damage and the first turrets. After the list it goes greedy.
 *  Milestones whose next level is a cores unlock can't be saved toward
 *  (tokens come from boss kills, not thrift) — they're skipped until a token
 *  is in hand (see spendCores). */
const BUILD_ORDER: { id: string; level: number }[] = [
  { id: 'static_charge', level: 2 }, // the field IS the primary attack
  { id: 'turret_gatling', level: 1 },
  { id: 'salvage', level: 4 }, // graduates the economy trunk
  { id: 'wide_field', level: 2 },
  { id: 'turret_power', level: 1 },
  { id: 'turret_flak', level: 1 },
  { id: 'pulse_cycle', level: 1 },
  { id: 'reinforced', level: 2 }, // graduates toward the Shield Generator...
  { id: 'bld_shield', level: 1 }, // ...the answer to the N13-15 wall
  { id: 'turret_power', level: 3 },
  { id: 'turret_speed', level: 2 },
  { id: 'turret_laser', level: 1 }, // via wide_field (battery path)
  { id: 'static_charge', level: 5 },
  { id: 'field_coils', level: 1 },
  // Mid-game: the banded prices mean greedy dribbling on cheap levels never
  // banks up for the run-defining unlocks — keep naming them so the smart
  // strategy SAVES (walking the gatling side-chain toward the Missile Pod,
  // then survivability, then the deep power spine).
  { id: 'turret_missile', level: 1 }, // walks gatling_spin 3 → belt 1
  { id: 'turret_flak', level: 2 }, // graduates toward Tesla — the N20 token pick
  { id: 'compact', level: 1 },
  { id: 'pulse_cycle', level: 3 },
  { id: 'overcharge_matrix', level: 1 },
  { id: 'static_link', level: 1 },
  { id: 'bunker', level: 1 },
  { id: 'turret_power2', level: 1 },
  // The world-1 gate (N30, an absolute-hp boss) is a raw DPS check: pump
  // the damage spine before it instead of nickel-and-diming stat filler.
  { id: 'overcharge_matrix', level: 3 },
  { id: 'static_link', level: 3 },
  { id: 'turret_tesla', level: 3 }, // scrap levels once the token unlocks it
  { id: 'turret_power2', level: 3 },
  // Past this, greedy cheapest-first mops up while war_effort eats surplus.
];

/** Next unmet, scrap-payable milestone (walking down to the first unbought
 *  prerequisite when locked). Skips milestones parked on a cores unlock. */
function nextGoal(run: RunState): Candidate | null {
  for (const step of BUILD_ORDER) {
    if ((run.upgrades[step.id] ?? 0) >= step.level) continue;
    let node = getNode(step.id)!;
    // Walk down to the first unmet prerequisite if the goal is locked —
    // graduation gates included (the walk buys prereq LEVELS until the gate
    // is met, one shop iteration at a time).
    while (!isUnlocked(node, run.upgrades, worldOf(run.night))) {
      const missing = missingRequirement(node, run.upgrades);
      if (!missing) break;
      node = getNode(reqId(missing))!;
    }
    const price = nextPrice(node, run.upgrades[node.id] ?? 0);
    if (price === null) continue;
    if (price.currency !== 'scrap') continue; // token-gated: not saveable
    return { node, price };
  }
  return null;
}

function shopSmart(run: RunState): string[] {
  const bought: string[] = [];
  // Boss tokens first: they never compete with scrap plans.
  spendCores(run, bought);
  for (;;) {
    const goal = nextGoal(run);
    // Build order finished: fall back to greedy spending.
    if (goal === null) {
      greedySpend(run, bought);
      return bought;
    }
    if (bank(run, goal.price.currency) >= goal.price.amount) {
      buy(run, goal, bought);
      continue;
    }
    // Saving toward the milestone — but loose change still flows. The old
    // level-gates made the unlock walk buy cheap prereq LEVELS on the way
    // to each goal; when the gates went, that power stream silently went
    // with them and world-1 runs starved (sim: 8-fail stall on N19 with
    // thousands banked). Anything costing ≤25% of the goal barely delays
    // it and keeps the build growing — which is how a person saves.
    const change = affordable(run).filter(
      (c) =>
        c.price.currency === 'scrap' &&
        c.node.id !== SINK_ID &&
        c.price.amount <= goal.price.amount * 0.25,
    );
    if (change.length === 0) return bought;
    buy(run, cheapest(change), bought);
  }
}

/** Spend until nothing is affordable. Returns the node ids bought, in order
 *  (repeats mean multiple levels). Mutates `run` like the Day screen does. */
export function shop(run: RunState, strategy: StrategyName): string[] {
  if (strategy === 'smart') return shopSmart(run);
  const bought: string[] = [];
  spendCores(run, bought);
  greedySpend(run, bought, FOCUS[strategy]);
  return bought;
}
