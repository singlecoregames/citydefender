import { COMBO, nightInWorld, worldOf } from '../core/balance';
import type { GameState } from '../core/types';
import { t } from './i18n';

/** DOM HUD: scrap counter, night/wave indicator, ammo pips, combo meter.
 *  The night-end overlay is handled by the Day screen (see ui/dayscreen). */
export class Hud {
  private readonly scrapEl = document.getElementById('hud-scrap')!;
  private readonly waveEl = document.getElementById('hud-wave')!;
  private readonly ammoEl = document.getElementById('hud-ammo')!;
  private readonly comboEl = document.getElementById('hud-combo')!;
  private pipCount = 0;
  /** Idle auto-fire gauge: a thin bar under the ammo pips that fills while
   *  the full magazine sits untouched, and stays lit during auto-fire. */
  private readonly autoGauge = document.createElement('div');
  private readonly autoFill = document.createElement('div');

  constructor() {
    this.autoGauge.className = 'autofire-gauge';
    this.autoFill.className = 'autofire-fill';
    this.autoGauge.appendChild(this.autoFill);
  }

  render(state: GameState, totalScrap: number, cores: number, data: number): void {
    let bank = `⬡ ${totalScrap}`;
    if (cores > 0) bank += `   ◆ ${cores}`;
    if (data > 0) bank += `   ▣ ${data}`;
    this.scrapEl.textContent = bank;
    const wave = Math.min(state.director.waveIndex + 1, state.director.totalWaves);
    const boss = state.enemies.some((e) => e.kind === 'boss') ? t().bossTag : '';
    this.waveEl.textContent =
      t().nightWave(worldOf(state.night), nightInWorld(state.night), wave, state.director.totalWaves) + boss;
    this.renderCombo(state.combo);
    this.syncPips(state.cannon.maxAmmo);
    for (let i = 0; i < this.pipCount; i++) {
      this.ammoEl.children[i]!.classList.toggle('full', i < state.cannon.ammo);
    }
    // The auto-fire gauge only exists once the node is owned (threshold > 0).
    const threshold = state.cannon.autoFireThreshold;
    this.autoGauge.classList.toggle('hidden', threshold <= 0);
    if (threshold > 0) {
      const idle = Math.min(1, state.cannon.idleSeconds / threshold);
      this.autoFill.style.width = `${idle * 100}%`;
      this.autoGauge.classList.toggle('armed', idle >= 1);
    }
  }

  /** Combo meter: hidden until a streak of 2, then count + scrap multiplier. */
  private renderCombo(combo: number): void {
    if (combo < 2) {
      this.comboEl.classList.add('hidden');
      return;
    }
    const mul = 1 + COMBO.scrapPerStack * Math.min(combo, COMBO.maxStacks);
    this.comboEl.textContent = `⚡ ${combo}  ×${mul.toFixed(2)}`;
    this.comboEl.classList.remove('hidden');
  }

  /** Rebuild ammo pips when the magazine size changes (upgrades). The pips
   *  must stay the first `pipCount` children (render indexes into them); the
   *  auto-fire gauge rides along as the last child. */
  private syncPips(maxAmmo: number): void {
    if (this.pipCount === maxAmmo) return;
    this.ammoEl.replaceChildren();
    for (let i = 0; i < maxAmmo; i++) {
      const pip = document.createElement('div');
      pip.className = 'ammo-pip';
      this.ammoEl.appendChild(pip);
    }
    this.ammoEl.appendChild(this.autoGauge);
    this.pipCount = maxAmmo;
  }
}
