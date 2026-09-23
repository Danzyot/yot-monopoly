// The contract every mini-game module fulfils. A module is pure data + rules:
// it never touches money, turns or the log (the Game does that from the
// outcome it reports), never reads a clock or Math.random (both arrive in
// `ctx`), and keeps its state JSON-serialisable so live rounds survive a
// server restart inside the game snapshot.

import type { MinigameBody, MinigameMove, MinigamePayout } from '../../../../shared/minigames.ts';

export type Rng = (n: number) => number; // integer in [0, n)

/** A rule violation by the player (bad move, wrong time). The Game turns it into an EngineError. */
export class MinigameError extends Error {}

export function reject(msg: string): never {
  throw new MinigameError(msg);
}

export interface Ctx {
  now: number;
  rng: Rng;
}

export interface StartCtx extends Ctx {
  /** The player who landed on the arcade. */
  host: string;
  /** Everyone else still in the game, in seat order. */
  others: string[];
}

/** What bots may look at: the clock, plus a per-bot seed for human-like jitter. */
export interface BotCtx {
  now: number;
  seed: number;
}

/** Display helpers so headlines read like the rest of the game log. */
export interface Names {
  name(id: string): string;
  money(n: number): string;
}

export interface Outcome {
  headline: string;
  payouts: MinigamePayout[];
}

export interface MinigameDef<S> {
  start(c: StartCtx): S;
  /** Who may send moves right now. */
  players(s: S): string[];
  /** Apply a move or throw MinigameError; must not change state when it throws. */
  move(s: S, player: string, m: MinigameMove, c: Ctx): void;
  /** Server-clock time at which tick() must run next (may be secret, e.g. the GO time). */
  deadline(s: S): number;
  /** Advance past the deadline: auto-play whoever didn't move, or end the round. */
  tick(s: S, c: Ctx): void;
  done(s: S): boolean;
  outcome(s: S, n: Names): Outcome;
  /** The part of the state that is safe to show everyone. */
  body(s: S): MinigameBody;
  /** Deadline shown to clients, or null while showing it would give something away. */
  publicEndsAt(s: S): number | null;
  /** A participant left the game. Return true if the round can't go on without them. */
  drop(s: S, player: string): boolean;
  /** Move every stored time forward (after a restart, so nobody loses their go to downtime). */
  shift(s: S, ms: number): void;
  /** A sensible move for a computer player, or null to wait (bots are polled). */
  bot(s: S, player: string, c: BotCtx): MinigameMove | null;
  /** How long the result stays on screen before play continues. */
  resultMs: number;
}

/** FNV-1a: stable per-(round, player) numbers, so bot "randomness" replays exactly. */
export function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A human-ish delay in [lo, hi] ms, derived from the bot's seed and a salt. */
export function jitter(seed: number, lo: number, hi: number, salt: string | number = 0): number {
  return lo + (hash(seed, salt) % (hi - lo + 1));
}

export function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
