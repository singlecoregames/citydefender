import type { KeyValueStore } from '../core/save';

/** Web implementation of the save store. The Electron/Capacitor adapters will
 *  provide the same interface backed by the Steam cloud path / Preferences. */
export class WebStore implements KeyValueStore {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage full or unavailable (private mode) — ignore; run stays in memory.
    }
  }
}
