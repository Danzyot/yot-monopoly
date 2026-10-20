// Crash-safe snapshots of every live game. Written every few seconds and on
// shutdown; read once at boot. A deploy or crash mid-tournament costs at most
// the hand in play (rolled back and refunded) — never the tournament.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveAudit } from './audit.ts';
import { DATA_DIR } from './paths.ts';
import { settleCashSnapshot } from './legacycash.ts';
import { registry } from './registry.ts';
import { addCashRecord } from './store.ts';
import type { TournamentSnap } from './tournament/tournament.ts';

const LIVE_FILE = join(DATA_DIR, 'live.json');
// A snapshot much older than a level could ever be is a stale artifact, not
// a game anyone is waiting to get back to.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface LiveSnap {
  v: 1;
  savedAt: number;
  tournaments: TournamentSnap[];
  // Only in snapshots written before cash tables were retired (legacycash.ts).
  cashTables?: unknown;
}

let lastSnapshotAt = 0;

export function snapshotLive(): void {
  try {
    const snap: LiveSnap = {
      v: 1,
      savedAt: Date.now(),
      tournaments: [...registry.tournaments.values()]
        .filter(t => t.state === 'registering' || t.state === 'running'
          || t.state === 'break' || t.state === 'paused')
        .map(t => t.snapshot()),
    };
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${LIVE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap));
    renameSync(tmp, LIVE_FILE);
    lastSnapshotAt = snap.savedAt;
  } catch (e) {
    console.error('Live snapshot failed:', e);
  }
}

export function lastSnapshotAge(): number | null {
  return lastSnapshotAt ? Date.now() - lastSnapshotAt : null;
}

// Call once at boot, after the socket emitter is attached. Tournaments come
// back; cash tables from an older snapshot are closed and filed instead
// (`closedCash` lists their ids).
export function restoreLive(): { tournaments: number; closedCash: string[] } {
  const out = { tournaments: 0, closedCash: [] as string[] };
  try {
    if (!existsSync(LIVE_FILE)) return out;
    const snap = JSON.parse(readFileSync(LIVE_FILE, 'utf8')) as LiveSnap;
    if (!snap || typeof snap !== 'object' || snap.v !== 1) return out;
    // Settled whatever the snapshot's age: nothing else ever will, and the
    // next snapshot (seconds from now) no longer carries them.
    out.closedCash = closeLegacyCashTables(snap.cashTables);
    if (Date.now() - snap.savedAt > MAX_AGE_MS) {
      console.log('Live snapshot is stale — skipping restore.');
      return out;
    }
    for (const ts of Array.isArray(snap.tournaments) ? snap.tournaments : []) {
      try {
        registry.restoreTournament(ts);
        out.tournaments += 1;
      } catch (e) {
        console.error(`Could not restore tournament ${ts?.id}:`, e);
      }
    }
  } catch (e) {
    console.error('Live restore failed:', e);
  }
  return out;
}

function closeLegacyCashTables(tables: unknown): string[] {
  const closed: string[] = [];
  if (!Array.isArray(tables)) return closed;
  const now = Date.now();
  for (const raw of tables) {
    try {
      const rec = settleCashSnapshot(raw, now);
      if (!rec) continue;
      addCashRecord(rec);
      closed.push(rec.id);
    } catch (e) {
      console.error('Could not close a cash table from the last snapshot:', e);
    }
  }
  return closed;
}

// Snapshot on an interval; the server's shutdown path calls snapshotLive()
// one final time. Railway sends SIGTERM before replacing the container on
// every deploy — that final write is what makes deploys invisible to
// running games.
export function armPersistence(): void {
  const iv = setInterval(snapshotLive, 5_000);
  iv.unref?.();
  // Audit history changes slowly — a relaxed cadence keeps writes cheap.
  const ivA = setInterval(saveAudit, 30_000);
  ivA.unref?.();
}
