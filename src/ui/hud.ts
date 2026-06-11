import type { GameState } from '../core/types';

/** DOM HUD: scrap counter, night/wave indicator, ammo pips. The night-end
 *  overlay is handled by the Day screen (see ui/dayscreen). */
export class Hud {
  private readonly scrapEl = document.getElementById('hud-scrap')!;
  private readonly waveEl = document.getElementById('hud-wave')!;
  private readonly ammoEl = document.getElementById('hud-ammo')!;
  private pipCount = 0;

  render(state: GameState, totalScrap: number, cores: number): void {
    this.scrapEl.textContent = cores > 0 ? `⬡ ${totalScrap}   ◆ ${cores}` : `⬡ ${totalScrap}`;
    const wave = Math.min(state.director.waveIndex + 1, state.director.totalWaves);
    const boss = state.enemies.some((e) => e.kind === 'boss') ? '  ☠ BOSS' : '';
    this.waveEl.textContent = `NIGHT ${state.night} — WAVE ${wave}/${state.director.totalWaves}${boss}`;
    this.syncPips(state.cannon.maxAmmo);
    for (let i = 0; i < this.pipCount; i++) {
      this.ammoEl.children[i]!.classList.toggle('full', i < state.cannon.ammo);
    }
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
