// "Play now" on the home page (rooms:quickJoin, cards:quickJoin): one tap
// into a game. The player goes to the open public lobby nearest to filling
// up, or, when there is none, to a new public table of their own with a
// couple of bots in it (which the next quick player can join). Shared by
// Monopoly (../sockets.ts) and Cards (cards/sockets.ts); the choice is pure so
// it can be tested on its own.

/** One table, as much of it as the choice reads. */
export interface QuickTable {
  code: string;
  private: boolean;
  status: 'lobby' | 'playing' | 'finished';
  seats: readonly { id: string; isBot: boolean; connected: boolean }[];
  maxPlayers: number;
  createdAt: number;
  /** Discord-gated, or a tournament's assigned seats: never a quick join. */
  restricted: boolean;
}

/** Bots a new quick table starts with (the host can add or remove more in the lobby). */
export const QUICK_BOTS = { monopoly: 2, cards: 3 } as const;

/**
 * Where `playerId` should sit: a public lobby they are already seated at, else
 * the open public lobby with the fewest seats left (most humans, then the
 * oldest, on a tie), with someone connected at it, that they were not removed
 * or barred from. Null when there is none (open a new one).
 */
export function pickQuickTable<T extends QuickTable>(
  tables: Iterable<T>, playerId: string,
  blocked: (t: T) => boolean = () => false,
): T | null {
  const open: T[] = [];
  for (const t of tables) {
    if (t.private || t.status !== 'lobby' || t.restricted) continue;
    if (t.seats.some(s => s.id === playerId)) return t;
    if (t.seats.length >= t.maxPlayers) continue;
    if (!t.seats.some(s => !s.isBot && s.connected)) continue;
    if (blocked(t)) continue;
    open.push(t);
  }
  const humans = (t: T) => t.seats.filter(s => !s.isBot).length;
  open.sort((a, b) =>
    (a.maxPlayers - a.seats.length) - (b.maxPlayers - b.seats.length)
    || humans(b) - humans(a)
    || a.createdAt - b.createdAt);
  return open[0] ?? null;
}
