// Reaction Race: everyone still in the game. After a random 1.5–4 s wait the
// server shows GO; the first tap it receives after the GO time wins. A tap
// before GO disqualifies you. Timing is measured on the server (receipt time
// vs. the GO time) — not frame-perfect, but fair enough for casual play. The
// GO time is secret until it arrives, so the view hides the deadline.

import { jitter, reject, type MinigameDef } from './types.ts';

export const REACTION_PRIZE = 100;
export const REACTION_MIN_WAIT_MS = 1_500;
export const REACTION_MAX_WAIT_MS = 4_000;
/** How long after GO a tap still counts. */
export const REACTION_WINDOW_MS = 3_000;

export interface ReactionState {
  players: string[];
  /** Hidden until it passes. */
  goAt: number;
  go: boolean;
  early: string[];
  winner: string | null;
  winnerMs: number | null;
  expired: boolean;
}

export const reaction: MinigameDef<ReactionState> = {
  start: c => ({
    players: [c.host, ...c.others],
    goAt: c.now + REACTION_MIN_WAIT_MS + c.rng(REACTION_MAX_WAIT_MS - REACTION_MIN_WAIT_MS + 1),
    go: false,
    early: [],
    winner: null,
    winnerMs: null,
    expired: false,
  }),
  players: s => s.players,
  move(s, id, m, c) {
    if (m.kind !== 'tap') reject('Tap!');
    if (s.early.includes(id)) reject('You jumped the gun — you are out this round');
    if (s.winner || s.expired) reject('Too late');
    if (c.now < s.goAt) {
      s.early.push(id);
      return;
    }
    if (c.now > s.goAt + REACTION_WINDOW_MS) reject('Too late');
    // A tap can beat the GO broadcast by a few ms; what counts is the server's GO time.
    s.go = true;
    s.winner = id;
    s.winnerMs = c.now - s.goAt;
  },
  deadline: s => (s.go ? s.goAt + REACTION_WINDOW_MS : s.goAt),
  tick(s, c) {
    if (!s.go) s.go = true;
    else if (c.now >= s.goAt + REACTION_WINDOW_MS) s.expired = true;
  },
  done: s => !!s.winner || s.expired || s.players.every(id => s.early.includes(id)),
  outcome(s, n) {
    if (s.winner) {
      return {
        headline: `${n.name(s.winner)} tapped first — ${s.winnerMs} ms after GO!`,
        payouts: [{ player: s.winner, amount: REACTION_PRIZE }],
      };
    }
    if (s.players.every(id => s.early.includes(id))) return { headline: 'Everyone jumped the gun. Nobody wins.', payouts: [] };
    return { headline: 'Nobody tapped in time.', payouts: [] };
  },
  body: s => ({ kind: 'reaction', go: s.go, prize: REACTION_PRIZE, early: s.early, winner: s.winner, winnerMs: s.winnerMs }),
  publicEndsAt: s => (s.go ? s.goAt + REACTION_WINDOW_MS : null),
  drop(s, id) {
    s.players = s.players.filter(p => p !== id);
    s.early = s.early.filter(p => p !== id);
    return s.players.length === 0;
  },
  shift(s, ms) { s.goAt += ms; },
  bot(s, id, c) {
    // Bots wait for GO like everyone else and react at human speed.
    if (!s.go || s.winner || s.expired || s.early.includes(id) || c.now > s.goAt + REACTION_WINDOW_MS) return null;
    return c.now - s.goAt >= jitter(c.seed, 320, 760) ? { kind: 'tap' } : null;
  },
  resultMs: 4_000,
};
