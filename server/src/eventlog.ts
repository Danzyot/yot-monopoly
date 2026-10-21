// A durable record of what a game actually did.
//
// The running commentary a tournament produces — registrations, level
// changes, table breaks, balance moves, kicks, eliminations — lived only in
// a 200-entry in-memory chat buffer, and the engine writes almost nothing to
// the console. So after the first live event there was no way to answer
// "were the offline players actually removed?" or "did the tables stay
// balanced?": the evidence had been overwritten during the event itself and
// nothing reached the platform logs either.
//
// Lines are appended to the data volume as they happen, so they survive the
// event, a deploy and a crash.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

export interface GameEvent {
  ts: number;
  gameId: string;
  gameName: string;
  text: string;
}

const FILE = join(DATA_DIR, 'events.log');
// Roughly a season of events at a tournament a week; past this the file is
// rolled once so the current one never grows without bound.
const MAX_BYTES = 8 * 1024 * 1024;

// Kept in memory too, so the admin views answer without touching the disk.
let recent: GameEvent[] = [];
const MAX_MEMORY = 5_000;

export function loadEvents(): void {
  try {
    if (!existsSync(FILE)) return;
    const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    recent = lines.slice(-MAX_MEMORY).flatMap(l => {
      try {
        const e = JSON.parse(l) as GameEvent;
        return typeof e?.ts === 'number' && typeof e?.text === 'string' ? [e] : [];
      } catch { return []; }
    });
  } catch (e) {
    console.error('Could not load the event log:', e);
  }
}

export function logGameEvent(gameId: string, gameName: string, text: string): void {
  const e: GameEvent = { ts: Date.now(), gameId, gameName, text };
  recent.push(e);
  if (recent.length > MAX_MEMORY) recent.shift();
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    // Rolling before the write keeps one previous file rather than deleting
    // history outright — a post-mortem after a long event still has the start.
    if (existsSync(FILE) && statSync(FILE).size > MAX_BYTES) {
      renameSync(FILE, `${FILE}.1`);
    }
    appendFileSync(FILE, `${JSON.stringify(e)}\n`);
  } catch {
    // A full or read-only volume must never take a game down; the in-memory
    // copy still serves the admin views for the rest of the run.
  }
}

// Everything for one game, oldest first. Reads the file rather than memory so
// a finished event is still answerable after thousands of later lines.
export function eventsForGame(gameId: string): GameEvent[] {
  const out: GameEvent[] = [];
  for (const path of [`${FILE}.1`, FILE]) {
    try {
      if (!existsSync(path)) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line || !line.includes(gameId)) continue;
        try {
          const e = JSON.parse(line) as GameEvent;
          if (e.gameId === gameId) out.push(e);
        } catch { /* a torn final line */ }
      }
    } catch { /* unreadable half of the pair */ }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** The recent lines held in memory, oldest first (the dashboard's Analytics tab counts them). */
export function recentEvents(): readonly GameEvent[] {
  return recent;
}

// The games that left a record, newest first — what the operator picks from.
export function loggedGames(): { gameId: string; gameName: string; events: number; from: number; to: number }[] {
  const by = new Map<string, { gameId: string; gameName: string; events: number; from: number; to: number }>();
  for (const e of recent) {
    const row = by.get(e.gameId);
    if (row) {
      row.events += 1;
      row.to = Math.max(row.to, e.ts);
      row.gameName = e.gameName || row.gameName;
    } else {
      by.set(e.gameId, { gameId: e.gameId, gameName: e.gameName, events: 1, from: e.ts, to: e.ts });
    }
  }
  return [...by.values()].sort((a, b) => b.to - a.to);
}
