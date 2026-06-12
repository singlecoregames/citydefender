import { COMBO } from '../core/balance';
import type { GameState } from '../core/types';

/** DOM HUD: scrap counter, night/wave indicator, ammo pips, combo meter.
 *  The night-end overlay is handled by the Day screen (see ui/dayscreen). */
export class Hud {
  private readonly scrapEl = document.getElementById('hud-scrap')!;
  private readonly waveEl = document.getElementById('hud-wave')!;
  private readonly ammoEl = document.getElementById('hud-ammo')!;
  private readonly comboEl = document.getElementById('hud-combo')!;
  private pipCount = 0;

  render(state: GameState, totalScrap: number, cores: number, data: number): void {
    let bank = `⬡ ${totalScrap}`;
    if (cores > 0) bank += `   ◆ ${cores}`;
    if (data > 0) bank += `   ▣ ${data}`;
    this.scrapEl.textContent = bank;
    const wave = Math.min(state.director.waveIndex + 1, state.director.totalWaves);
    const boss = state.enemies.some((e) => e.kind === 'boss') ? '  ☠ BOSS' : '';
    this.waveEl.textContent = `NIGHT ${state.night} — WAVE ${wave}/${state.director.totalWaves}${boss}`;
    this.renderCombo(state.combo);
    this.syncPips(state.cannon.maxAmmo);
    for (let i = 0; i < this.pipCount; i++) {
      this.ammoEl.children[i]!.classList.toggle('full', i < state.cannon.ammo);
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

  /** Rebuild ammo pips when the magazine size changes (upgrades). */
  private syncPips(maxAmmo: number): void {
    if (this.pipCount === maxAmmo) return;
    this.ammoEl.replaceChildren();
    for (let i = 0; i < maxAmmo; i++) {
      const pip = document.createElement('div');
      pip.className = 'ammo-pip';
      this.ammoEl.appendChild(pip);
    }
    this.pipCount = maxAmmo;
  }
}
