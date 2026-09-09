// Folding a message into the log you already have.
//
// Both chat panels get the same treatment from the server: on every subscribe
// it replays the recent backlog, and a subscribe happens more often than it
// looks — every reconnect re-runs it, which is what a tab going to sleep and
// waking up produces. The pages used to append whatever arrived, so a tab
// switch pasted the last stretch of conversation in a second time, and the
// window the client kept was short enough that the replay pushed the real
// history off the top. Both complaints — "it duplicates" and "it reloads
// fresh" — were the same missing step.
//
// Every message carries a stable server-side id, so the fix is to merge on it
// and keep the result in time order. Written against the shape it actually
// needs rather than the ChatMsg type: this file is reached from the server's
// tests too, and those run under stricter module resolution.

// Long enough that a replay can never push a live conversation out of view.
export const CHAT_KEEP = 300;

export function mergeChat<T extends { id: string; ts: number }>(
  existing: T[], incoming: T,
): T[] {
  // The common case by far: a genuinely new message, newer than everything
  // held. Checking the tail first keeps this off the hot path.
  const last = existing[existing.length - 1];
  if (last && incoming.id === last.id) return existing;
  if (existing.some(m => m.id === incoming.id)) return existing;

  const out = [...existing, incoming];
  // A replay can arrive out of order relative to what is already held.
  if (last && incoming.ts < last.ts) out.sort((a, b) => a.ts - b.ts);
  return out.length > CHAT_KEEP ? out.slice(-CHAT_KEEP) : out;
}
