// Live card tables survive restarts, like Monopoly rooms (../persist.ts): a
// snapshot of every unfinished table goes to the data volume every few seconds
// (only when something changed, off the event loop) and on the way out, and
// is loaded at boot. Players reconnect to the same seats; autopilot covers
// anyone who does not.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CardsRegistry, CardsRoomSnapshot } from './rooms.ts';
import { readJson, writeJson } from '../jsonstore.ts';
import { DATA_DIR } from '../paths.ts';

export const CARDS_LIVE_FILE = 'cards-live.json';
const EVERY_MS = 5_000;
let writing = false;

export function restoreCardsLive(registry: CardsRegistry): number {
  const snaps = readJson<CardsRoomSnapshot[]>(CARDS_LIVE_FILE, []);
  return Array.isArray(snaps) ? registry.restore(snaps) : 0;
}

/** Synchronous and unconditional, for the way out. */
export function saveCardsLive(registry: CardsRegistry): void {
  try {
    writeJson(CARDS_LIVE_FILE, registry.snapshot());
  } catch (e) {
    console.error('Could not snapshot live card tables:', e);
  }
}

/** The periodic save: skipped when nothing changed, written to a temp file and renamed into place. */
export async function saveCardsIfDirty(registry: CardsRegistry, dir = DATA_DIR): Promise<boolean> {
  if (writing) return false;
  if (!registry.takeDirty()) return false;
  writing = true;
  try {
    const data = JSON.stringify(registry.snapshot());
    await mkdir(dir, { recursive: true });
    const file = join(dir, CARDS_LIVE_FILE);
    const tmp = `${file}.async.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
    return true;
  } catch (e) {
    registry.markDirty();
    console.error('Could not snapshot live card tables:', e);
    return false;
  } finally {
    writing = false;
  }
}

export function armCardsPersistence(registry: CardsRegistry): void {
  setInterval(() => { void saveCardsIfDirty(registry); }, EVERY_MS).unref();
  // Monopoly's SIGTERM/SIGINT handler (../persist.ts) saves its rooms and calls
  // process.exit(): 'exit' runs after it, synchronously, on every way out.
  process.once('exit', () => saveCardsLive(registry));
}
