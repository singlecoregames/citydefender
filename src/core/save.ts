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
  // The drag-sweep era's Heat Sink became Field Coils (same slot and price)
  // when the sweep was remade into the cursor aura — carry levels over.
  if (upgrades['heat_sink'] !== undefined) {
    upgrades['field_coils'] = upgrades['heat_sink'] ?? 0;
    delete upgrades['heat_sink'];
  }
  // The reset-prestige era: its permanent upgrades became tier-2 tree nodes
  // with the same ids — carry bought levels over (head_start has no heir).
  const legacy = (env.run as { prestigeUpgrades?: Record<string, number> }).prestigeUpgrades;
  if (legacy) {
    for (const id of ['arsenal_core', 'drone_escort', 'mirv_warhead', 'salvage_core']) {
      if (legacy[id]) upgrades[id] = Math.max(upgrades[id] ?? 0, legacy[id]!);
    }
  }
  // Three-currencies era: the data (▣) currency and the repeatable
  // cores/data sinks are gone — cores are boss tokens now (1 per kill,
  // ~12 per campaign), so clamp hoards earned under the old trickle.
  delete upgrades['data_broker'];
  delete upgrades['core_overclock'];
  const migrated = {
    ...base,
    ...env.run,
    cores: Math.min(env.run.cores ?? 0, 12),
    upgrades,
  };
  // Strip retired fields so old saves don't haunt the state.
  delete (migrated as Record<string, unknown>)['prestigeUpgrades'];
  delete (migrated as Record<string, unknown>)['prestige'];
  delete (migrated as Record<string, unknown>)['pp'];
  delete (migrated as Record<string, unknown>)['data'];
  return migrated;
}

export function saveRun(store: KeyValueStore, run: RunState): void {
  store.set(SAVE_KEY, serialize(run));
}

export function loadRun(store: KeyValueStore): RunState {
  return deserialize(store.get(SAVE_KEY));
}
