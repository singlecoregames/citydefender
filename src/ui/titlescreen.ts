import type { RunState } from '../core/run';
import { lang, LANGS, setLang, t } from './i18n';

/**
 * Launch title overlay (placeholder title until the game is named). Shown once
 * at startup over the frozen night scene: START continues the saved run (or
 * begins a fresh one), RESET SAVE wipes the save behind a two-tap confirm,
 * matching the Day screen's reset pattern. The language button cycles the
 * supported UI languages and re-labels everything on the spot.
 */
export class TitleScreen {
  private readonly root = document.getElementById('titlescreen')!;
  private readonly startBtn = document.getElementById('title-start') as HTMLButtonElement;
  private readonly resetBtn = document.getElementById('title-reset') as HTMLButtonElement;
  private readonly langBtn = document.getElementById('title-lang') as HTMLButtonElement;
  private armed = false;
  private disarmTimer: ReturnType<typeof setTimeout> | undefined;
  private run: RunState | null = null;

  constructor(onStart: () => void, onReset: () => void, onLangChange: () => void) {
    this.startBtn.addEventListener('click', () => {
      this.hide();
      onStart();
    });
    this.resetBtn.addEventListener('click', () => {
      if (!this.armed) {
        this.armed = true;
        this.resetBtn.classList.add('armed');
        this.resetBtn.textContent = t().wipeSaveConfirm;
        this.disarmTimer = setTimeout(() => this.disarm(), 3000);
      } else {
        onReset();
      }
    });
    this.langBtn.addEventListener('click', () => {
      const codes = LANGS.map((l) => l.code);
      setLang(codes[(codes.indexOf(lang()) + 1) % codes.length]!);
      this.refreshText();
      onLangChange();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Populate the start button from the save and show the overlay. */
  show(run: RunState): void {
    this.run = run;
    this.refreshText();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** (Re-)label everything on the title screen in the active language. */
  private refreshText(): void {
    this.langBtn.textContent = `🌐 ${LANGS.find((l) => l.code === lang())!.label}`;
    if (this.run) {
      const fresh = this.run.night <= 1 && this.run.bestNight === 0;
      this.startBtn.textContent = fresh ? t().start : t().continueNight(this.run.night);
    }
    this.disarm();
  }

  private disarm(): void {
    clearTimeout(this.disarmTimer);
    this.armed = false;
    this.resetBtn.classList.remove('armed');
    this.resetBtn.textContent = t().resetSave;
  }
}
