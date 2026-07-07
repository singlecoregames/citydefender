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
import { lang, t } from './ui/i18n';
import { TitleScreen } from './ui/titlescreen';

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

/** Re-label the static texts owned by the HTML (everything else re-reads the
 *  string table when it renders). Called at boot and on language change. */
function applyStaticText(): void {
  document.documentElement.lang = lang();
  document.getElementById('title-tagline')!.textContent = t().tagline;
  document.getElementById('title-version')!.textContent = t().versionNote;
  document.getElementById('day-next')!.textContent = t().nextNight;
  document.getElementById('day-reset')!.textContent = t().resetRun;
}
applyStaticText();

// Launch title over the frozen night; the sim only steps once it's dismissed.
const titleScreen = new TitleScreen(
  () => {}, // START: just dismiss — the prepared night takes over
  () => {
    // RESET SAVE (double-confirmed in the UI): wipe and boot fresh.
    saveRun(store, newRun());
    location.reload();
  },
  applyStaticText, // language switched: refresh the shared static labels
);
titleScreen.show(run);

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
  if (dayScreen.visible || titleScreen.visible) return; // clicks belong to the overlay UI
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  pending.push({ type: 'fire', x: world.x, y: world.y });
});

// Aiming counts as presence: moving the pointer resets the auto-fire idle
// timer without firing. One wake per tick is plenty.
container.addEventListener('pointermove', () => {
  if (dayScreen.visible || titleScreen.visible) return;
  if (!pending.some((c) => c.type === 'wake')) pending.push({ type: 'wake' });
});

/** Apply the night result to the run, persist, flash the outcome banner over
 *  the frozen field for a beat, then open the Day screen. */
const bannerEl = document.getElementById('night-banner')!;

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
  bannerEl.textContent =
    outcome === 'victory' ? t().nightSurvived(clearedNight) : t().citiesLost;
  bannerEl.className = outcome;
  setTimeout(() => {
    bannerEl.className = 'hidden';
    dayScreen.show(run, outcome, clearedNight, dataEarned);
  }, 1800);
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
    if (sim.state.phase === 'playing' && !titleScreen.visible) {
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
