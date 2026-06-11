import { DT } from './core/balance';
import { nightSeed, type RunState } from './core/run';
import { loadRun, saveRun } from './core/save';
import { Sim, type NightConfig } from './core/sim';
import type { Command } from './core/types';
import { resolveStats } from './core/tree';
import { generateNight } from './core/waves';
import { WebStore } from './platform/store';
import { Renderer } from './render/renderer';
import { DayScreen } from './ui/dayscreen';
import { Hud } from './ui/hud';

const container = document.getElementById('app')!;
const renderer = new Renderer(container);
const hud = new Hud();
const store = new WebStore();

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
);

function nightConfigFor(r: RunState): NightConfig {
  return { night: r.night, waves: generateNight(r.night), stats: resolveStats(r.upgrades) };
}

function startNight(r: RunState): Sim {
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
function resolveNight(outcome: 'victory' | 'defeat', scrapEarned: number): void {
  const clearedNight = run.night;
  run.scrap += scrapEarned;
  if (outcome === 'victory') {
    run.bestNight = Math.max(run.bestNight, run.night);
    run.night += 1;
  }
  saveRun(store, run);
  dayScreen.show(run, outcome, clearedNight);
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
        if (ev.type === 'nightEnded' && !nightResolved) {
          nightResolved = true;
          resolveNight(ev.outcome, ev.scrapEarned);
        }
      }
    }
    acc -= DT;
  }

  renderer.render(sim.state);
  hud.render(sim.state, run.scrap + (nightResolved ? 0 : sim.state.scrap));
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
