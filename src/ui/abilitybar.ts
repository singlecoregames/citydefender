import type { AbilityKind, GameState } from '../core/types';
import type { AbilityLevels } from '../core/tree';
import { t } from './i18n';

const ORDER: { kind: AbilityKind; key: string }[] = [
  { kind: 'emp', key: '1' },
  { kind: 'megabomb', key: '2' },
  { kind: 'freefire', key: '3' },
  { kind: 'surge', key: '4' },
];

/** What to show on a running ability: remaining seconds for the timed effects,
 *  remaining shots for the Free Fire salvo, or null when it isn't active. */
function activeReadout(kind: AbilityKind, state: GameState): string | null {
  const a = state.ability;
  if (kind === 'surge' && a.surge > 0) return `${Math.ceil(a.surge)}s`;
  if (kind === 'emp' && a.empFreeze > 0) return `${Math.ceil(a.empFreeze)}s`;
  if (kind === 'freefire' && a.freefire > 0) return `${a.freefire}`;
  return null;
}

/** Bottom-of-screen ability buttons. Only the abilities the player owns this
 *  night are shown; each reflects its cooldown and fires on tap/click. */
export class AbilityBar {
  private readonly bar = document.getElementById('ability-bar')!;
  private readonly tint = document.getElementById('freefire-tint')!;
  private readonly buttons = new Map<
    AbilityKind,
    { el: HTMLButtonElement; cd: HTMLElement; active: HTMLElement }
  >();
  private owned: AbilityLevels = { emp: 0, megabomb: 0, freefire: 0, surge: 0 };

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
    for (const { kind, key } of ORDER) {
      if (levels[kind] <= 0) continue;
      const el = document.createElement('button');
      el.className = 'ability-btn';
      el.innerHTML = `<span class="key">${key}</span><span class="label">${t().ability[kind]}</span>`;
      const cd = document.createElement('span');
      cd.className = 'cd';
      cd.style.display = 'none';
      el.appendChild(cd);
      // While the effect is running, this shows what's left of it — remaining
      // seconds (Surge/EMP) or remaining salvo shots (Free Fire).
      const active = document.createElement('span');
      active.className = 'active';
      active.style.display = 'none';
      el.appendChild(active);
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation(); // don't also fire the cannon
        this.onUse(kind);
      });
      this.bar.appendChild(el);
      this.buttons.set(kind, { el, cd, active });
    }
  }

  render(state: GameState): void {
    for (const [kind, { el, cd, active }] of this.buttons) {
      const remaining = state.ability.cooldown[kind];
      const ready = remaining <= 0;
      // A running effect (Surge/EMP timer, or a Free Fire salvo) takes over the
      // readout: show what's left of it on top and skip the cooldown cover,
      // which resumes once the effect ends.
      const activeText = activeReadout(kind, state);
      if (activeText !== null) {
        el.classList.remove('ready', 'cooling');
        el.classList.add('active');
        cd.style.display = 'none';
        active.style.display = 'flex';
        active.textContent = activeText;
        continue;
      }
      active.style.display = 'none';
      el.classList.remove('active');
      el.classList.toggle('ready', ready);
      el.classList.toggle('cooling', !ready);
      if (ready) {
        cd.style.display = 'none';
      } else {
        cd.style.display = 'flex';
        cd.textContent = Math.ceil(remaining).toString();
      }
    }
    this.tint.classList.toggle('hidden', state.ability.freefire <= 0);
  }
}
