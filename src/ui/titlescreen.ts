import type { RunState } from '../core/run';

/**
 * Launch title overlay (placeholder title until the game is named). Shown once
 * at startup over the frozen night scene: START continues the saved run (or
 * begins a fresh one), RESET SAVE wipes the save behind a two-tap confirm,
 * matching the Day screen's reset pattern.
 */
export class TitleScreen {
  private readonly root = document.getElementById('titlescreen')!;
  private readonly startBtn = document.getElementById('title-start') as HTMLButtonElement;
  private readonly resetBtn = document.getElementById('title-reset') as HTMLButtonElement;
  private armed = false;
  private disarmTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(onStart: () => void, onReset: () => void) {
    this.startBtn.addEventListener('click', () => {
      this.hide();
      onStart();
    });
    this.resetBtn.addEventListener('click', () => {
      if (!this.armed) {
        this.armed = true;
        this.resetBtn.classList.add('armed');
        this.resetBtn.textContent = 'TAP AGAIN TO WIPE SAVE';
        this.disarmTimer = setTimeout(() => this.disarm(), 3000);
      } else {
        onReset();
      }
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Populate the start button from the save and show the overlay. */
  show(run: RunState): void {
    const fresh = run.night <= 1 && run.bestNight === 0;
    this.startBtn.textContent = fresh ? 'START' : `CONTINUE ▸ NIGHT ${run.night}`;
    this.disarm();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private disarm(): void {
    clearTimeout(this.disarmTimer);
    this.armed = false;
    this.resetBtn.classList.remove('armed');
    this.resetBtn.textContent = 'RESET SAVE';
  }
}
