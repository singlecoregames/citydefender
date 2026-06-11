/**
 * Balance simulator CLI. Plays full runs headlessly with a scripted player
 * and reports pacing (per-night durations, projected total playtime) and
 * currency curves, so balance changes are judged by numbers, not feel.
 *
 *   npm run sim                                   # one run, defaults
 *   npm run sim -- --night=50 --seed=3 --skill=0.6 --strategy=automation
 *   npm run sim -- --runs=5                       # seeds N..N+4, summary only
 */
import { getNode } from '../../src/core/tree';
import { simulateRun, type NightRecord, type RunReport } from './meta';
import { STRATEGIES, type StrategyName } from './strategy';

/** Seconds a human spends on the Day screen per night (shopping/reading). */
const DAY_SCREEN_SECONDS = 35;

/** GDD §4.4 pacing targets (cumulative playtime when each night is reached). */
const MILESTONES: { night: number; targetMin: [number, number] }[] = [
  { night: 10, targetMin: [25, 35] },
  { night: 20, targetMin: [60, 100] },
  { night: 35, targetMin: [140, 200] },
  { night: 50, targetMin: [260, 300] },
];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([\w-]+)=(.*)$/.exec(arg);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

function fmtTime(totalSec: number): string {
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m${String(Math.round(totalSec % 60)).padStart(2, '0')}s`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`;
}

function pad(v: string | number, width: number): string {
  return String(v).padStart(width);
}

/** Wall-clock estimate including Day screens, after `count` night records. */
function elapsedWithDays(records: NightRecord[], count: number): number {
  let sec = 0;
  for (let i = 0; i < count; i++) sec += records[i]!.durationSec + DAY_SCREEN_SECONDS;
  return sec;
}

function printNightTable(report: RunReport): void {
  console.log(
    'night try  result   t(s)   earn⬡  combo  city   bank⬡    ◆   ▣  buys',
  );
  for (const r of report.records) {
    const buys = r.purchases.length;
    const note = r.purchases
      .filter((id) => id.startsWith('turret_') || id.startsWith('bld_') || id.startsWith('ability_'))
      .filter((id, i, a) => a.indexOf(id) === i)
      .join(',');
    console.log(
      `${pad(r.night, 4)} ${pad(r.attempt, 3)}  ${r.outcome.padEnd(7)}` +
        `${pad(Math.round(r.durationSec), 5)} ${pad(r.scrapEarned, 7)}` +
        `${pad(r.maxCombo, 6)} ${pad(`${r.citiesLeft}/3`, 6)}` +
        `${pad(r.bank.scrap, 7)} ${pad(r.bank.cores, 4)} ${pad(r.bank.data, 3)}` +
        `  ${buys > 0 ? `${buys}${note ? ` (${note})` : ''}` : '-'}`,
    );
  }
}

function printSummary(report: RunReport): void {
  const recs = report.records;
  const defeats = recs.filter((r) => r.outcome === 'defeat').length;
  const timeouts = recs.filter((r) => r.outcome === 'timeout').length;
  const nightSec = recs.reduce((a, r) => a + r.durationSec, 0);
  const totalSec = nightSec + recs.length * DAY_SCREEN_SECONDS;

  console.log('');
  console.log(
    `result: ${report.cleared ? `cleared N${report.options.targetNight}` : report.stuck ? `STUCK at N${report.run.night}` : `stopped at N${report.run.night}`}` +
      ` — ${recs.length} nights played (${defeats} defeats, ${timeouts} timeouts)`,
  );
  console.log(
    `playtime: nights ${fmtTime(nightSec)} + day screens ${fmtTime(recs.length * DAY_SCREEN_SECONDS)}` +
      ` = ~${fmtTime(totalSec)} total`,
  );

  // Pacing vs the GDD roadmap.
  for (const m of MILESTONES) {
    const idx = recs.findIndex((r) => r.night === m.night && r.outcome === 'victory');
    if (idx < 0) continue;
    const at = elapsedWithDays(recs, idx + 1);
    const [lo, hi] = m.targetMin;
    const ok = at >= lo * 60 && at <= hi * 60 ? 'ok' : at < lo * 60 ? 'FAST' : 'SLOW';
    console.log(
      `  N${m.night} cleared at ${fmtTime(at)} (target ${lo}–${hi}m) ${ok}`,
    );
  }

  // What the run actually bought, by branch.
  const branchLevels = new Map<string, number>();
  for (const [id, lvl] of Object.entries(report.run.upgrades)) {
    const branch = getNode(id)?.branch ?? '?';
    if (branch === 'core') continue;
    branchLevels.set(branch, (branchLevels.get(branch) ?? 0) + lvl);
  }
  const branches = [...branchLevels.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${b} ${n}`)
    .join(', ');
  console.log(`tree levels: ${branches}`);
  console.log(
    `final bank: ⬡${report.run.scrap} ◆${report.run.cores} ▣${report.run.data}` +
      ` — data earned total: ${recs.reduce((a, r) => a + r.dataEarned, 0)}`,
  );

  // First-unlock timeline for the run-defining nodes.
  const firsts = new Map<string, number>();
  for (const r of recs) {
    for (const id of r.purchases) {
      if (!firsts.has(id)) firsts.set(id, r.night);
    }
  }
  const keyNodes = [...firsts.entries()]
    .filter(([id]) => id.startsWith('turret_') || id.startsWith('ability_') || id.startsWith('bld_'))
    .filter(([id]) => !['turret_power', 'turret_speed', 'turret_range'].includes(id))
    .sort((a, b) => a[1] - b[1])
    .map(([id, n]) => `${id.replace(/^(turret_|ability_|bld_)/, '')}@N${n}`)
    .join(' ');
  console.log(`unlocks: ${keyNodes}`);
}

const args = parseArgs(process.argv.slice(2));
const seed = Number(args['seed'] ?? 1);
const runs = Number(args['runs'] ?? 1);
const strategy = (args['strategy'] ?? 'smart') as StrategyName;
if (!STRATEGIES.includes(strategy)) {
  console.error(`unknown strategy '${strategy}' (use ${STRATEGIES.join('/')})`);
  process.exit(1);
}
const options = {
  seed,
  targetNight: Number(args['night'] ?? 50),
  strategy,
  skill: Number(args['skill'] ?? 0.7),
};

console.log(
  `City Defender balance sim — strategy=${options.strategy} skill=${options.skill}` +
    ` target=N${options.targetNight} seed=${seed}${runs > 1 ? `..${seed + runs - 1}` : ''}`,
);

if (runs === 1) {
  const report = simulateRun(options);
  printNightTable(report);
  printSummary(report);
} else {
  // Multi-run mode: one summary line per seed, then the averages.
  let clearedCount = 0;
  let totalSecSum = 0;
  for (let i = 0; i < runs; i++) {
    const report = simulateRun({ ...options, seed: seed + i });
    const recs = report.records;
    const totalSec =
      recs.reduce((a, r) => a + r.durationSec, 0) + recs.length * DAY_SCREEN_SECONDS;
    const defeats = recs.filter((r) => r.outcome !== 'victory').length;
    if (report.cleared) {
      clearedCount++;
      totalSecSum += totalSec;
    }
    console.log(
      `seed ${seed + i}: ${report.cleared ? 'cleared' : report.stuck ? `stuck N${report.run.night}` : `stopped N${report.run.night}`}` +
        ` in ${fmtTime(totalSec)} (${recs.length} nights, ${defeats} fails)` +
        ` bank ⬡${report.run.scrap} ◆${report.run.cores} ▣${report.run.data}`,
    );
  }
  if (clearedCount > 0) {
    console.log(
      `\ncleared ${clearedCount}/${runs} — avg playtime ${fmtTime(totalSecSum / clearedCount)}`,
    );
  }
}
