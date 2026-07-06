/**
 * Day-phase purchase strategies for the balance simulator. Mirrors the Day
 * screen's buy rules (unlock prerequisites, per-currency banks, level caps)
 * and spends every dawn until nothing is affordable.
 */
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
    if (!isUnlocked(node, run.upgrades)) continue;
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
    while (!isUnlocked(node, run.upgrades)) {
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
  // Cores/Data never compete with the scrap goal — spend them greedily.
  for (;;) {
    const cands = affordable(run).filter((c) => nodeCurrency(c.node) !== 'scrap');
    if (cands.length === 0) break;
    buy(run, cheapest(cands), bought);
  }
  // Once the build order is finished, fall back to greedy spending.
  if (nextGoal(run) === null) {
    for (;;) {
      const cands = affordable(run);
      if (cands.length === 0) break;
      buy(run, cheapest(cands), bought);
    }
  }
  return bought;
}

/** Spend until nothing is affordable. Returns the node ids bought, in order
 *  (repeats mean multiple levels). Mutates `run` like the Day screen does. */
export function shop(run: RunState, strategy: StrategyName): string[] {
  if (strategy === 'smart') return shopSmart(run);
  const bought: string[] = [];
  for (;;) {
    const cands = affordable(run);
    if (cands.length === 0) break;
    const focus = FOCUS[strategy];
    const inFocus = focus ? cands.filter((c) => c.node.branch === focus) : [];
    const pick = cheapest(inFocus.length > 0 ? inFocus : cands);
    buy(run, pick, bought);
  }
  return bought;
}
