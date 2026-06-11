import { BOSS_NIGHT_INTERVAL, DT } from './core/balance';
import { dawnInterest, firstClearCores, newRun, nightSeed, type RunState } from './core/run';
import { loadRun, saveRun } from './core/save';
import { Sim, type NightConfig } from './core/sim';
import type { Command } from './core/types';
import { abilitiesFromTree, buildingsFromTree, resolveStats, turretsFromTree } from './core/tree';
import { generateNight } from './core/waves';
import { WebStore } from './platform/store';
import { Renderer } from './render/renderer';
import { AbilityBar } from './ui/abilitybar';
import { DayScreen } from './ui/dayscreen';
import { Hud } from './ui/hud';

const container = document.getElementById('app')!;
const renderer = new Renderer(container);
const hud = new Hud();
const store = new WebStore();
const abilityBar = new AbilityBar((kind) => {
  if (sim.state.phase === 'playing') pending.push({ type: 'ability', ability: kind });
});

let run: RunState = loadRun(store);
let sim: Sim = startNight(run);
let nightResolved = false;

const dayScreen = new DayScreen(
  (r) => saveRun(store, r), // on purchase
  (r) => {
    // on "Next Night": advance and start the next night.
    sim = startNight(r);
    nightResolved = false;
  },
  () => {
    // on reset (double-confirmed in the UI): wipe the run and start over.
    saveRun(store, newRun());
    location.reload();
  },
);

function nightConfigFor(r: RunState): NightConfig {
  return {
    night: r.night,
    waves: generateNight(r.night),
    stats: resolveStats(r.upgrades),
    turrets: turretsFromTree(r.upgrades),
    buildings: buildingsFromTree(r.upgrades),
    abilities: abilitiesFromTree(r.upgrades),
    boss: r.night % BOSS_NIGHT_INTERVAL === 0,
  };
}

function startNight(r: RunState): Sim {
  abilityBar.setOwned(abilitiesFromTree(r.upgrades));
  return new Sim(nightSeed(r), nightConfigFor(r));
}

/** Commands queued between fixed-timestep ticks. */
let pending: Command[] = [];

container.addEventListener('pointerdown', (e) => {
  if (dayScreen.visible) return; // clicks belong to the shop UI
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  pending.push({ type: 'fire', x: world.x, y: world.y });
});

/** Apply the night result to the run, persist, and show the Day screen. */
function resolveNight(outcome: 'victory' | 'defeat', scrapEarned: number, dataEarned: number): void {
  const clearedNight = run.night;
  run.scrap += scrapEarned;
  run.scrap += dawnInterest(run.scrap, resolveStats(run.upgrades).scrapInterestRate);
  run.data += dataEarned;
  if (outcome === 'victory') {
    if (clearedNight > run.bestNight) run.cores += firstClearCores(clearedNight);
    run.bestNight = Math.max(run.bestNight, run.night);
    run.night += 1;
  }
  saveRun(store, run);
  dayScreen.show(run, outcome, clearedNight, dataEarned);
}

// Fixed timestep with accumulator; render every animation frame.
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25;

function frame(now: number): void {
  acc += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  // Only advance the sim while actually playing a night.
  while (acc >= DT) {
    if (sim.state.phase === 'playing') {
      const events = sim.step(pending);
      pending = [];
      renderer.onEvents(events);
      for (const ev of events) {
        if (ev.type === 'bossKilled') {
          run.cores += ev.cores;
          saveRun(store, run);
        }
        if (ev.type === 'nightEnded' && !nightResolved) {
          nightResolved = true;
          resolveNight(ev.outcome, ev.scrapEarned, ev.dataEarned);
        }
      }
    }
    acc -= DT;
  }

  renderer.render(sim.state);
  hud.render(sim.state, run.scrap + (nightResolved ? 0 : sim.state.scrap), run.cores, run.data);
  abilityBar.render(sim.state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
