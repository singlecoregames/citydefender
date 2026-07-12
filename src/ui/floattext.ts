import { formatAmount } from './i18n';

/** Floating kill rewards: a "+N ⬡" that drifts up from the kill and fades.
 *  DOM spans over the canvas (same layer family as the HUD), CSS-animated so
 *  the render loop never touches them after spawn. Combo tiers recolour the
 *  number — the streak's value is visible at the kill site, not just in the
 *  corner meter. */
export class FloatLayer {
  private readonly el = document.getElementById('float-layer')!;
  /** Hard cap on live numbers: a megabomb wiping a swarm must not spawn a
   *  hundred spans. Overflow kills simply don't print — the pop/shake still
   *  carry them. */
  private static readonly MAX_ACTIVE = 24;

  spawn(screenX: number, screenY: number, reward: number, combo: number): void {
    if (this.el.childElementCount >= FloatLayer.MAX_ACTIVE) return;
    const span = document.createElement('span');
    const tier = combo >= 25 ? 2 : combo >= 10 ? 1 : 0;
    span.className = `float-num tier${tier}`;
    span.textContent = `+${formatAmount(reward)}`;
    span.style.left = `${screenX}px`;
    span.style.top = `${screenY}px`;
    span.addEventListener('animationend', () => span.remove());
    this.el.appendChild(span);
  }
}
