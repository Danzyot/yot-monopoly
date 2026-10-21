// Names players chose for themselves (the welcome tour's first step), kept by
// account so the next Discord sign-in signs them in under it again instead of
// their Discord name. Cleaned like every other display name (auth.ts
// cleanName); bans go by account, never by name, so a new name escapes nothing.
import { cleanName } from './auth.ts';
import { debouncedWriter, readJson } from './jsonstore.ts';
import type { PlayerProfile } from '../../shared/types.ts';

const FILE = 'display-names.json';
/** The longest name a player may choose (Discord names are kept to 24). */
export const CHOSEN_NAME_MAX = 20;

let names: Record<string, { name: string; at: number }> = {};
const save = debouncedWriter(FILE, () => names);

export function loadDisplayNames(): void {
  const raw = readJson<Record<string, { name?: unknown; at?: unknown }>>(FILE, {});
  names = {};
  for (const [id, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const name = cleanName(v?.name, CHOSEN_NAME_MAX);
    if (name) names[id] = { name, at: Number(v?.at) || 0 };
  }
}

export function chosenName(id: string): string | null {
  return names[id]?.name ?? null;
}

/** Save `raw` as this account's name; returns the cleaned name, or throws when nothing usable is left. */
export function setChosenName(id: string, raw: unknown, now = Date.now()): string {
  const name = cleanName(raw, CHOSEN_NAME_MAX);
  if (!name) throw new Error('A name needs at least 2 letters or numbers');
  names[id] = { name, at: now };
  save();
  return name;
}

/** The profile under its chosen name, if its account has one. */
export function withChosenName(p: PlayerProfile): PlayerProfile {
  const name = chosenName(p.id);
  return name ? { ...p, name } : p;
}

/** A deleted player (erase.ts). */
export function forgetChosenName(id: string): boolean {
  if (!names[id]) return false;
  delete names[id];
  save();
  return true;
}

/** For tests. */
export function resetDisplayNames(): void {
  names = {};
}
