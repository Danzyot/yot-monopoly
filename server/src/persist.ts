// Crash-safe snapshots of every live game. Written every few seconds and on
// shutdown; read once at boot. A deploy or crash mid-tournament costs at most
// the hand in play (rolled back and refunded) — never the tournament.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveAudit } from './audit.ts';
import { DATA_DIR } from './paths.ts';
import { registry, type CashTableSnap } from './registry.ts';
import type { TournamentSnap } from './tournament/tournament.ts';

const LIVE_FILE = join(DATA_DIR, 'live.json');
// A snapshot much older than a level could ever be is a stale artifact, not
// a game anyone is waiting to get back to.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface LiveSnap {
  v: 1;
  savedAt: number;
  tournaments: TournamentSnap[];
  cashTables: CashTableSnap[];
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
      cashTables: [...registry.cashTables.values()]
        .filter(t => !t.closed && t.seatedCount() > 0)
        .map(t => registry.cashSnapshot(t)),
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

// Call once at boot, after the socket emitter is attached.
export function restoreLive(): { tournaments: number; cashTables: number } {
  const out = { tournaments: 0, cashTables: 0 };
  try {
    if (!existsSync(LIVE_FILE)) return out;
    const snap = JSON.parse(readFileSync(LIVE_FILE, 'utf8')) as LiveSnap;
    if (!snap || snap.v !== 1) return out;
    if (Date.now() - snap.savedAt > MAX_AGE_MS) {
      console.log('Live snapshot is stale — skipping restore.');
      return out;
    }
    for (const ts of snap.tournaments ?? []) {
      try {
        registry.restoreTournament(ts);
        out.tournaments += 1;
      } catch (e) {
        console.error(`Could not restore tournament ${ts.id}:`, e);
      }
    }
    for (const cs of snap.cashTables ?? []) {
      try {
        registry.restoreCashTable(cs);
        out.cashTables += 1;
      } catch (e) {
        console.error(`Could not restore cash table ${cs.id}:`, e);
      }
    }
  } catch (e) {
    console.error('Live restore failed:', e);
  }
  return out;
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
