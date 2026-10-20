// Cash tables are gone: Chog Poker runs tournaments only. A live snapshot
// written before that change can still hold cash tables that were open when
// the old process stopped. They are not brought back. Each one is closed the
// way a host closing it always was: every seat cashed out at the chips in
// front of it (a hand in progress was already rolled back and refunded when
// the snapshot was taken), and the session filed in cash-history.json, where
// Past games on the dashboard still shows who played and how it ended.
//
// Whatever is in the file, this never throws: a table it cannot read is
// skipped, and a seat it cannot read is left out of the ledger.
import type { CashRecord, LedgerEntry } from '../../shared/types.ts';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown, dflt: string): string => (typeof v === 'string' && v.trim() ? v : dflt);

/** The record a cash table in an old snapshot closes into, or null when it has no id to file it under. */
export function settleCashSnapshot(raw: unknown, closedAt = Date.now()): CashRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Record<string, unknown>;
  if (typeof snap.id !== 'string' || !snap.id) return null;
  const ledger: LedgerEntry[] = [];
  for (const s of Array.isArray(snap.seats) ? snap.seats : []) {
    if (!s || typeof s !== 'object') continue;
    const seat = s as Record<string, unknown>;
    const player = seat.player as Record<string, unknown> | null | undefined;
    if (!player || typeof player !== 'object' || typeof player.id !== 'string') continue;
    const cashOut = num(seat.stack);
    const buyIn = num(seat.buyInTotal);
    ledger.push({
      playerId: player.id,
      name: str(player.name, 'Player'),
      avatar: typeof player.avatar === 'string' ? player.avatar : '',
      buyIn, cashOut, stack: null, net: cashOut - buyIn,
    });
  }
  ledger.sort((a, b) => b.net - a.net);
  return {
    id: snap.id,
    name: str(snap.name, 'Cash table'),
    hostName: str(snap.hostName, '—'),
    // Snapshots never carried the opening time; the close is the honest stand-in.
    openedAt: num(snap.createdAt) || closedAt,
    closedAt,
    sb: num(snap.sb),
    bb: num(snap.bb),
    hands: num(snap.handNumber),
    ledger,
  };
}
