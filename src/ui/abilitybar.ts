import { ABILITIES } from '../core/balance';
import type { AbilityKind, GameState } from '../core/types';
import type { AbilityLevels } from '../core/tree';

const ORDER: { kind: AbilityKind; label: string; key: string }[] = [
  { kind: 'emp', label: 'EMP', key: '1' },
  { kind: 'megabomb', label: 'BOMB', key: '2' },
  { kind: 'slowmo', label: 'SLOW', key: '3' },
];

function maxCooldown(kind: AbilityKind, level: number): number {
  const s = ABILITIES[kind];
  return Math.max(s.minCooldown, s.baseCooldown - s.cooldownPerLevel * (level - 1));
}

/** Bottom-of-screen ability buttons. Only the abilities the player owns this
 *  night are shown; each reflects its cooldown and fires on tap/click. */
export class AbilityBar {
  private readonly bar = document.getElementById('ability-bar')!;
  private readonly tint = document.getElementById('slowmo-tint')!;
  private readonly buttons = new Map<AbilityKind, { el: HTMLButtonElement; cd: HTMLElement }>();
  private owned: AbilityLevels = { emp: 0, megabomb: 0, slowmo: 0 };

  constructor(private readonly onUse: (kind: AbilityKind) => void) {
    window.addEventListener('keydown', (e) => {
      const entry = ORDER.find((o) => o.key === e.key);
      if (entry && this.owned[entry.kind] > 0) this.onUse(entry.kind);
    });
  }

  /** Rebuild the buttons for the abilities owned this night. */
  setOwned(levels: AbilityLevels): void {
    this.owned = levels;
    this.bar.replaceChildren();
    this.buttons.clear();
    for (const { kind, label, key } of ORDER) {
      if (levels[kind] <= 0) continue;
      const el = document.createElement('button');
      el.className = 'ability-btn';
      el.innerHTML = `<span class="key">${key}</span><span class="label">${label}</span>`;
      const cd = document.createElement('span');
      cd.className = 'cd';
      cd.style.display = 'none';
      el.appendChild(cd);
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation(); // don't also fire the cannon
        this.onUse(kind);
      });
      this.bar.appendChild(el);
      this.buttons.set(kind, { el, cd });
    }
  }

  render(state: GameState): void {
    for (const [kind, { el, cd }] of this.buttons) {
      const remaining = state.ability.cooldown[kind];
      const ready = remaining <= 0;
      el.classList.toggle('ready', ready);
      el.classList.toggle('cooling', !ready);
      if (ready) {
        cd.style.display = 'none';
      } else {
        cd.style.display = 'flex';
        cd.textContent = Math.ceil(remaining).toString();
      }
    }
    this.tint.classList.toggle('hidden', state.ability.slowmo <= 0);
  }
}

export { maxCooldown };
