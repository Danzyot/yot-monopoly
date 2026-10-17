// Live rooms survive restarts: a snapshot of every unfinished room is written
// to the data volume every few seconds (only when something changed, and off
// the event loop) and on shutdown, and loaded at boot. Players reconnect to
// the same seats; autopilot covers anyone who does not.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Registry, RoomSnapshot } from './rooms.ts';
import { readJson, writeJson } from './jsonstore.ts';
import { DATA_DIR } from './paths.ts';

const FILE = 'live.json';
const EVERY_MS = 5_000;
/** When the file on disk was last known to match the rooms (written, or nothing had changed). */
let lastSaved = 0;
let writing = false;

export function restoreLive(registry: Registry): number {
  const snaps = readJson<RoomSnapshot[]>(FILE, []);
  return Array.isArray(snaps) ? registry.restore(snaps) : 0;
}

/** On shutdown: synchronous, unconditional, so nothing is lost on the way out. */
function save(registry: Registry) {
  try {
    writeJson(FILE, registry.snapshot());
    lastSaved = Date.now();
  } catch (e) {
    console.error('Could not snapshot live rooms:', e);
  }
}

/**
 * The periodic save: skipped when no room changed, otherwise written to a
 * temp file and renamed into place without blocking the game loop. Its temp
 * file is its own, so the shutdown save can never interleave with it.
 */
export async function saveIfDirty(registry: Registry, dir = DATA_DIR): Promise<boolean> {
  if (writing) return false;
  if (!registry.takeDirty()) {
    lastSaved = Date.now();
    return false;
  }
  writing = true;
  try {
    // Taken synchronously, right after the flags were cleared: any change
    // from here on marks the rooms dirty again for the next round.
    const data = JSON.stringify(registry.snapshot());
    await mkdir(dir, { recursive: true });
    const file = join(dir, FILE);
    const tmp = `${file}.async.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
    lastSaved = Date.now();
    return true;
  } catch (e) {
    registry.markDirty();
    console.error('Could not snapshot live rooms:', e);
    return false;
  } finally {
    writing = false;
  }
}

export function armPersistence(registry: Registry): void {
  setInterval(() => { void saveIfDirty(registry); }, EVERY_MS).unref();
  const shutdown = (sig: string) => {
    save(registry);
    console.log(`${sig}: saved live rooms, exiting`);
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

export function lastSnapshotAge(): number | null {
  return lastSaved ? Date.now() - lastSaved : null;
}
