import { newRun, type RunState } from './run';

/** Bump when the on-disk shape changes; add a migration branch below. */
export const SAVE_VERSION = 1;

interface SaveEnvelope {
  version: number;
  run: RunState;
}

/**
 * Storage-agnostic save codec. The platform layer supplies a simple
 * get/set string store (localStorage on web, Preferences on mobile, the
 * Steam cloud path on desktop), so the core stays free of platform APIs.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const SAVE_KEY = 'citydefender.save';

export function serialize(run: RunState): string {
  const env: SaveEnvelope = { version: SAVE_VERSION, run };
  return JSON.stringify(env);
}

/** Parse + migrate a save string. Returns a fresh run on missing/corrupt data. */
export function deserialize(raw: string | null): RunState {
  if (!raw) return newRun();
  let env: SaveEnvelope;
  try {
    env = JSON.parse(raw) as SaveEnvelope;
  } catch {
    return newRun();
  }
  return migrate(env);
}

function migrate(env: SaveEnvelope): RunState {
  // Future: if (env.version < 2) { ...transform env.run... }
  if (!env || typeof env.version !== 'number' || !env.run) return newRun();
  // Defensive defaults so older/partial saves never crash the sim.
  const base = newRun();
  // Always keep the command core owned so branch roots stay unlocked.
  const upgrades: RunState['upgrades'] = { core: 1, ...(env.run.upgrades ?? {}) };
  // Time Dilation was remade into Free Fire — carry bought levels over.
  if (upgrades['ability_slowmo'] !== undefined) {
    upgrades['ability_freefire'] = upgrades['ability_slowmo'] ?? 0;
    delete upgrades['ability_slowmo'];
  }
  return {
    ...base,
    ...env.run,
    upgrades,
  };
}

export function saveRun(store: KeyValueStore, run: RunState): void {
  store.set(SAVE_KEY, serialize(run));
}

export function loadRun(store: KeyValueStore): RunState {
  return deserialize(store.get(SAVE_KEY));
}
