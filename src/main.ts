import { AudioSystem } from './audio/sfx';
import { BOSS_NIGHT_INTERVAL, DT } from './core/balance';
import { newRun, nightSeed, type RunState } from './core/run';
import { loadRun, saveRun } from './core/save';
import { Sim, type NightConfig } from './core/sim';
import type { Command } from './core/types';
import { abilitiesFromTree, buildingsFromTree, resolveStats, turretsFromTree } from './core/tree';
import { generateNight } from './core/waves';
import { WebStore } from './platform/store';
import { Renderer } from './render/renderer';
import { AbilityBar } from './ui/abilitybar';
import { DayScreen } from './ui/dayscreen';
import { FloatLayer } from './ui/floattext';
import { Hud } from './ui/hud';
import { lang, t } from './ui/i18n';
import { TitleScreen } from './ui/titlescreen';

const container = document.getElementById('app')!;
const renderer = new Renderer(container);
const hud = new Hud();
const store = new WebStore();
const audio = new AudioSystem();
const floats = new FloatLayer();
const abilityBar = new AbilityBar((kind) => {
  if (sim.state.phase === 'playing') pending.push({ type: 'ability', ability: kind });
});

// Browsers keep the AudioContext suspended until a user gesture; any first
// press unlocks it (idempotent, so just listen forever).
document.addEventListener('pointerdown', () => audio.unlock());
document.addEventListener('keydown', () => audio.unlock());

// Mute toggle: pinned to the HUD, persisted by the AudioSystem.
const muteBtn = document.getElementById('hud-mute') as HTMLButtonElement;
const renderMuteBtn = (): void => {
  muteBtn.textContent = audio.isMuted() ? '🔇' : '🔊';
};
muteBtn.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation(); // don't also fire the cannon
  audio.unlock();
  audio.setMuted(!audio.isMuted());
  renderMuteBtn();
});
renderMuteBtn();

// Full-screen feedback layers (see index.html).
const flashEl = document.getElementById('fx-flash')!;
const vignetteEl = document.getElementById('fx-vignette')!;

/** Retrigger a one-shot CSS animation class on an fx layer. */
function flashClass(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth; // reflow restarts the animation
  el.classList.add(cls);
}

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
  () => {
    // Language switched: refresh the shared static labels and rebuild the
    // ability bar, whose button labels were baked at startNight.
    applyStaticText();
    abilityBar.setOwned(abilitiesFromTree(run.upgrades));
  },
);
titleScreen.show(run);

const dayScreen = new DayScreen(
  (r) => {
    audio.playPurchase();
    saveRun(store, r); // on purchase
  },
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
    waves: generateNight(r.night, r.failStreak),
    stats: resolveStats(r.upgrades),
    turrets: turretsFromTree(r.upgrades),
    buildings: buildingsFromTree(r.upgrades),
    abilities: abilitiesFromTree(r.upgrades),
    boss: r.night % BOSS_NIGHT_INTERVAL === 0,
    failStreak: r.failStreak,
  };
}

function startNight(r: RunState): Sim {
  abilityBar.setOwned(abilitiesFromTree(r.upgrades));
  return new Sim(nightSeed(r), nightConfigFor(r));
}

/** Commands queued between fixed-timestep ticks. */
let pending: Command[] = [];

// Pointer stream. Every move (hover included) is an 'aim' — the static
// field's aura simply follows the pointer. A tap fires one cannon shot at
// the same spot (the burst tool; the aura is the sustained attack).
container.addEventListener('pointerdown', (e) => {
  if (dayScreen.visible || titleScreen.visible) return; // clicks belong to the overlay UI
  // Keep receiving moves while a touch drags across (and off) the canvas.
  try {
    container.setPointerCapture(e.pointerId);
  } catch {
    /* capture is best-effort (some embedded webviews refuse it) */
  }
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  pending.push({ type: 'aim', x: world.x, y: world.y });
  pending.push({ type: 'fire', x: world.x, y: world.y });
});

container.addEventListener('pointermove', (e) => {
  if (dayScreen.visible || titleScreen.visible) return;
  const world = renderer.screenToWorld(e.clientX, e.clientY);
  pending.push({ type: 'aim', x: world.x, y: world.y });
});

/** Apply the night result to the run, persist, flash the outcome banner over
 *  the frozen field for a beat, then open the Day screen. */
const bannerEl = document.getElementById('night-banner')!;

function resolveNight(outcome: 'victory' | 'defeat', scrapEarned: number): void {
  const clearedNight = run.night;
  run.scrap += scrapEarned;
  if (outcome === 'victory') {
    run.bestNight = Math.max(run.bestNight, run.night);
    run.night += 1;
    run.failStreak = 0;
  } else {
    run.failStreak += 1; // defeat pity: the retry pays out better
  }
  saveRun(store, run);
  bannerEl.textContent =
    outcome === 'victory' ? t().nightSurvived(clearedNight) : t().citiesLost;
  bannerEl.className = outcome;
  setTimeout(() => {
    bannerEl.className = 'hidden';
    dayScreen.show(run, outcome, clearedNight);
  }, 1800);
}

// Fixed timestep with accumulator; render every animation frame.
let last = performance.now();
let acc = 0;
const MAX_FRAME = 0.25;

/** Boss-kill hit-stop: the sim freezes for this beat while rendering keeps
 *  running (particles fly, the camera kicks), so the kill visibly LANDS.
 *  Boss kills only — a stop on routine kills would stutter the whole night. */
const BOSS_HITSTOP_SECONDS = 0.18;
let hitStop = 0;

function frame(now: number): void {
  acc += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  // Only advance the sim while actually playing a night.
  while (acc >= DT) {
    if (sim.state.phase !== 'playing' || titleScreen.visible) {
      // Not simulating: drop queued input so a stale press/aim from the
      // night's last moments can't replay into the next night's first tick.
      pending = [];
    } else if (hitStop > 0) {
      // Frozen for the hit-stop beat. Queued input is kept, not dropped —
      // a shot tapped during the freeze fires on the first live tick.
      hitStop -= DT;
    } else {
      const events = sim.step(pending);
      pending = [];
      renderer.onEvents(events);
      audio.onEvents(events, sim.state);
      for (const ev of events) {
        if (ev.type === 'bossKilled') {
          hitStop = BOSS_HITSTOP_SECONDS;
          flashClass(flashEl, 'strong');
          run.cores += ev.cores;
          saveRun(store, run);
        }
        if (ev.type === 'enemyKilled' && ev.reward > 0) {
          const p = renderer.worldToScreen(ev.pos.x, ev.pos.y);
          floats.spawn(p.x, p.y, ev.reward, sim.state.combo);
        }
        if (ev.type === 'abilityUsed' && ev.ability === 'megabomb') flashClass(flashEl, 'soft');
        // A streak worth mourning flashes the edges red for a beat.
        if (ev.type === 'comboBroken' && ev.lost >= 5) flashClass(vignetteEl, 'combo-break');
        if (ev.type === 'bossSpawned') {
          bannerEl.textContent = t().bossWarning;
          bannerEl.className = 'boss';
          setTimeout(() => {
            // Leave it alone if the night-end banner has taken over meanwhile.
            if (bannerEl.className === 'boss') bannerEl.className = 'hidden';
          }, 1600);
        }
        if (ev.type === 'nightEnded' && !nightResolved) {
          nightResolved = true;
          resolveNight(ev.outcome, ev.scrapEarned);
        }
      }
    }
    acc -= DT;
  }
  audio.update(sim.state);

  // Low-HP heartbeat: the screen edges pulse red while the ground is nearly
  // gone (only during play — the day screen shouldn't throb).
  const hpNow = sim.state.cities.reduce((a, c) => a + c.hp, 0);
  const hpMax = sim.state.cities.reduce((a, c) => a + c.maxHp, 0);
  vignetteEl.classList.toggle(
    'danger',
    sim.state.phase === 'playing' && !titleScreen.visible && hpNow > 0 && hpNow / hpMax <= 0.34,
  );

  renderer.render(sim.state);
  hud.render(sim.state, run.scrap + (nightResolved ? 0 : sim.state.scrap), run.cores);
  abilityBar.render(sim.state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
