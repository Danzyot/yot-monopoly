// Tiny durable JSON files on the data volume: write to a temp file, then
// rename, so a crash mid-write never leaves half a file behind.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

export function readJson<T>(name: string, fallback: T): T {
  const file = join(DATA_DIR, name);
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.error(`Could not read ${name}:`, e);
    return fallback;
  }
}

/** Throws if the write fails, so callers can report it rather than pretend it saved. */
export function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

/** Debounced writer for data that changes often (connections, stats). */
export function debouncedWriter(name: string, get: () => unknown, ms = 2_000): () => void {
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    try { writeJson(name, get()); } catch (e) { console.error(`Could not save ${name}:`, e); }
  };
  process.once('beforeExit', () => { if (timer) { clearTimeout(timer); flush(); } });
  return () => {
    if (timer) return;
    timer = setTimeout(flush, ms);
    timer.unref?.();
  };
}
