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
  nextCost,
  nodeCurrency,
  TREE,
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
  cost: number;
}

function bank(run: RunState, node: TreeNode): number {
  const cur = nodeCurrency(node);
  return cur === 'cores' ? run.cores : cur === 'data' ? run.data : run.scrap;
}

function pay(run: RunState, node: TreeNode, cost: number): void {
  const cur = nodeCurrency(node);
  if (cur === 'cores') run.cores -= cost;
  else if (cur === 'data') run.data -= cost;
  else run.scrap -= cost;
}

function affordable(run: RunState): Candidate[] {
  const out: Candidate[] = [];
  for (const node of TREE) {
    if (node.branch === 'core') continue;
    if (!isUnlocked(node, run.upgrades, worldOf(run.night))) continue;
    const cost = nextCost(node, run.upgrades[node.id] ?? 0);
    if (cost === null || bank(run, node) < cost) continue;
    out.push({ node, cost });
  }
  return out;
}

/** Cheapest first; ties broken by id so runs stay reproducible. */
function cheapest(cands: Candidate[]): Candidate {
  return cands.reduce((a, b) =>
    b.cost < a.cost || (b.cost === a.cost && b.node.id < a.node.id) ? b : a,
  );
}

/** The repeatable sink nodes: they never compete with content. A player buys
 *  the new toy before +1-2% filler; sinks get the surplus of their currency. */
const SINK_IDS = new Set(['war_effort', 'core_overclock', 'data_broker']);

/** Cheapest NEXT price among unlocked, unmaxed content nodes of a currency —
 *  the amount worth saving toward — or null when that tree is bought out. */
function nextContentGoal(run: RunState, currency: ReturnType<typeof nodeCurrency>): number | null {
  let min: number | null = null;
  for (const node of TREE) {
    if (node.branch === 'core' || SINK_IDS.has(node.id)) continue;
    if (nodeCurrency(node) !== currency) continue;
    if (!isUnlocked(node, run.upgrades, worldOf(run.night))) continue;
    const cost = nextCost(node, run.upgrades[node.id] ?? 0);
    if (cost !== null && (min === null || cost < min)) min = cost;
  }
  return min;
}

/** Greedy spend: content cheapest-first; a sink only eats what's left over
 *  beyond the next content goal in ITS currency (so saving toward big nodes
 *  still happens — and a player walled with a bought-out tree dumps
 *  everything into the sinks). */
function greedySpend(run: RunState, bought: string[], focus?: TreeBranch): void {
  for (;;) {
    const cands = affordable(run);
    const content = cands.filter((c) => !SINK_IDS.has(c.node.id));
    if (content.length > 0) {
      const inFocus = focus ? content.filter((c) => c.node.branch === focus) : [];
      buy(run, cheapest(inFocus.length > 0 ? inFocus : content), bought);
      continue;
    }
    let spent = false;
    for (const sink of cands) {
      const goal = nextContentGoal(run, nodeCurrency(sink.node));
      if (goal !== null && bank(run, sink.node) - sink.cost < goal) continue;
      buy(run, sink, bought);
      spent = true;
      break;
    }
    if (!spent) break;
  }
}

function buy(run: RunState, pick: Candidate, bought: string[]): void {
  pay(run, pick.node, pick.cost);
  run.upgrades[pick.node.id] = (run.upgrades[pick.node.id] ?? 0) + 1;
  bought.push(pick.node.id);
}

/** The 'smart' strategy beelines these milestones in order, *saving* scrap
 *  for the next one instead of nickel-and-diming the cheap nodes — the way a
 *  player rushes damage and the first turrets. After the list it goes greedy. */
const BUILD_ORDER: { id: string; level: number }[] = [
  { id: 'blast_radius', level: 1 },
  { id: 'turret_gatling', level: 1 },
  { id: 'salvage', level: 2 },
  { id: 'autoloader', level: 2 },
  { id: 'turret_flak', level: 1 }, // via salvage (quartermaster path)
  { id: 'ability_megabomb', level: 1 }, // the early wave-clearer, right after flak
  { id: 'turret_speed', level: 2 }, // cheap turret dps before manual luxuries
  { id: 'turret_power', level: 2 },
  { id: 'turret_laser', level: 1 }, // via blast_radius (gunner path)
  { id: 'magazine', level: 1 },
  { id: 'turret_tesla', level: 1 }, // walks gatling_spin on the way
  { id: 'ability_emp', level: 1 },
  { id: 'wide_blast', level: 1 },
  { id: 'fast_intercept', level: 1 },
  { id: 'warhead', level: 1 },
  { id: 'turret_missile', level: 1 }, // walks reinforced (warden path)
  { id: 'turret_railgun', level: 1 }, // walks turret_range (operator path)
  { id: 'warhead', level: 3 },
  { id: 'heavy_warhead', level: 1 },
];

/** Next unmet milestone, redirected to a missing prerequisite when locked. */
function nextGoal(run: RunState): Candidate | null {
  for (const step of BUILD_ORDER) {
    if ((run.upgrades[step.id] ?? 0) >= step.level) continue;
    let node = getNode(step.id)!;
    // Walk down to the first unbought prerequisite if the goal is locked.
    while (!isUnlocked(node, run.upgrades, worldOf(run.night))) {
      const missing = node.requires.find((req) => (run.upgrades[req] ?? 0) < 1);
      if (!missing) break;
      node = getNode(missing)!;
    }
    const cost = nextCost(node, run.upgrades[node.id] ?? 0);
    if (cost === null) continue;
    return { node, cost };
  }
  return null;
}

function shopSmart(run: RunState): string[] {
  const bought: string[] = [];
  // Chase the build order, stopping (= saving) at the first unaffordable goal.
  for (;;) {
    const goal = nextGoal(run);
    if (!goal || bank(run, goal.node) < goal.cost) break;
    buy(run, goal, bought);
  }
  // Cores/Data never compete with the scrap goal — spend them greedily
  // (content only; sinks wait for the greedy phase's surplus rule).
  for (;;) {
    const cands = affordable(run).filter(
      (c) => nodeCurrency(c.node) !== 'scrap' && !SINK_IDS.has(c.node.id),
    );
    if (cands.length === 0) break;
    buy(run, cheapest(cands), bought);
  }
  // Once the build order is finished, fall back to greedy spending.
  if (nextGoal(run) === null) greedySpend(run, bought);
  return bought;
}

/** Spend until nothing is affordable. Returns the node ids bought, in order
 *  (repeats mean multiple levels). Mutates `run` like the Day screen does. */
export function shop(run: RunState, strategy: StrategyName): string[] {
  if (strategy === 'smart') return shopSmart(run);
  const bought: string[] = [];
  greedySpend(run, bought, FOCUS[strategy]);
  return bought;
}
