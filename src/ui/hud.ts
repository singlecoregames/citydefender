import { CANNON, NIGHT1_WAVES } from '../core/balance';
import type { GameEvent, GameState } from '../core/types';

/** DOM HUD: scrap counter, wave indicator, ammo pips, night-end overlay. */
export class Hud {
  private readonly scrapEl = document.getElementById('hud-scrap')!;
  private readonly waveEl = document.getElementById('hud-wave')!;
  private readonly ammoEl = document.getElementById('hud-ammo')!;
  private readonly overlayEl = document.getElementById('overlay')!;
  private readonly overlayTitleEl = document.getElementById('overlay-title')!;
  private readonly overlayBodyEl = document.getElementById('overlay-body')!;
  private readonly pips: HTMLElement[] = [];

  constructor(onRestart: () => void) {
    for (let i = 0; i < CANNON.maxAmmo; i++) {
      const pip = document.createElement('div');
      pip.className = 'ammo-pip';
      this.ammoEl.appendChild(pip);
      this.pips.push(pip);
    }
    document.getElementById('overlay-button')!.addEventListener('click', () => {
      this.overlayEl.classList.add('hidden');
      onRestart();
    });
  }

  onEvents(events: readonly GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'nightEnded') {
        this.overlayTitleEl.textContent = ev.outcome === 'victory' ? 'NIGHT SURVIVED' : 'CITIES LOST';
        this.overlayTitleEl.className = ev.outcome;
        this.overlayBodyEl.textContent = `⬡ ${ev.scrapEarned} scrap salvaged`;
        this.overlayEl.classList.remove('hidden');
      }
    }
  }

  render(state: GameState): void {
    this.scrapEl.textContent = `⬡ ${state.scrap}`;
    const wave = Math.min(state.director.waveIndex + 1, NIGHT1_WAVES.length);
    this.waveEl.textContent = `NIGHT 1 — WAVE ${wave}/${NIGHT1_WAVES.length}`;
    this.pips.forEach((pip, i) => {
      pip.classList.toggle('full', i < state.cannon.ammo);
    });
  }
}
