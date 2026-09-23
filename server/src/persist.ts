// Live rooms survive restarts: a snapshot of every unfinished room is written
// to the data volume every few seconds and on shutdown, and loaded at boot.
// Players reconnect to the same seats; autopilot covers anyone who does not.
import type { Registry, RoomSnapshot } from './rooms.ts';
import { readJson, writeJson } from './jsonstore.ts';

const FILE = 'live.json';
const EVERY_MS = 5_000;
let lastSaved = 0;

export function restoreLive(registry: Registry): number {
  const snaps = readJson<RoomSnapshot[]>(FILE, []);
  return Array.isArray(snaps) ? registry.restore(snaps) : 0;
}

function save(registry: Registry) {
  try {
    writeJson(FILE, registry.snapshot());
    lastSaved = Date.now();
  } catch (e) {
    console.error('Could not snapshot live rooms:', e);
  }
}

export function armPersistence(registry: Registry): void {
  setInterval(() => save(registry), EVERY_MS).unref();
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
