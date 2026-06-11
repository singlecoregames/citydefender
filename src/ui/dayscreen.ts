import type { RunState } from '../core/run';
import { nextCost, UPGRADES } from '../core/upgrades';

/**
 * Between-night Day screen: shows the night result and an upgrade shop where
 * Scrap is spent. Mutates the run's scrap/upgrades directly; calls back on
 * purchase (to save) and on "Next Night" (to start the next night).
 */
export class DayScreen {
  private readonly root = document.getElementById('dayscreen')!;
  private readonly titleEl = document.getElementById('day-title')!;
  private readonly subtitleEl = document.getElementById('day-subtitle')!;
  private readonly bankEl = document.getElementById('day-bank')!;
  private readonly shopEl = document.getElementById('day-shop')!;
  private run: RunState | null = null;

  constructor(
    private readonly onPurchase: (run: RunState) => void,
    private readonly onNext: (run: RunState) => void,
  ) {
    document.getElementById('day-next')!.addEventListener('click', () => {
      if (!this.run) return;
      this.hide();
      this.onNext(this.run);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show the Day screen after a night ended. `outcome` and `clearedNight`
   *  drive the header; the shop reflects the run's current scrap. */
  show(run: RunState, outcome: 'victory' | 'defeat', clearedNight: number): void {
    this.run = run;
    this.titleEl.textContent = outcome === 'victory' ? `NIGHT ${clearedNight} SURVIVED` : 'CITIES LOST';
    this.titleEl.className = outcome;
    this.subtitleEl.textContent =
      outcome === 'victory'
        ? 'Spend your scrap, then push into the next night.'
        : 'You held what you could. Regroup and try again.';
    this.renderShop();
    this.root.classList.remove('hidden');
  }

  private hide(): void {
    this.root.classList.add('hidden');
  }

  private renderShop(): void {
    const run = this.run!;
    this.bankEl.textContent = `⬡ ${run.scrap}`;
    this.shopEl.replaceChildren();
    for (const def of UPGRADES) {
      const level = run.upgrades[def.id] ?? 0;
      const cost = nextCost(def, level);

      const item = document.createElement('div');
      item.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML =
        `<div class="name">${def.name}</div>` +
        `<div class="desc">${def.description}</div>` +
        `<div class="lvl">LVL ${level}/${def.maxLevel}</div>`;

      const btn = document.createElement('button');
      if (cost === null) {
        btn.textContent = 'MAX';
        btn.classList.add('maxed');
        btn.disabled = true;
      } else {
        btn.textContent = `⬡ ${cost}`;
        btn.disabled = run.scrap < cost;
        btn.addEventListener('click', () => this.buy(def.id, cost));
      }

      item.append(info, btn);
      this.shopEl.appendChild(item);
    }
  }

  private buy(id: string, cost: number): void {
    const run = this.run!;
    if (run.scrap < cost) return;
    run.scrap -= cost;
    run.upgrades[id] = (run.upgrades[id] ?? 0) + 1;
    this.onPurchase(run);
    this.renderShop();
  }
}
