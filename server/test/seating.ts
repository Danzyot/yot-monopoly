// Starting a tournament no longer deals anybody in.
//
// Registering reserves a place; pressing Join table is what claims it. Most
// tests are about what happens once the field is at the felt, not about how it
// got there, so they say "start, and everybody sits down" in one line.
import type { Tournament } from '../src/tournament/tournament.ts';

// Every approved player claims their seat, in registration order.
export function joinEveryone(t: Tournament): void {
  for (const p of t.approvedPlayers()) {
    if (t.canJoinTable(p.id)) t.joinTable(p.id);
  }
}

export function startSeated(t: Tournament): void {
  t.start();
  joinEveryone(t);
}
