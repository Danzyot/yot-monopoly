// The Poker Daily ("Daily Hands"): ten No-Limit Hold'em decisions a day, the
// same for everyone. What client and server agree on lives here: the shapes
// the API sends, how answers score, how results rank, streaks and the share
// line. The hands themselves are dealt and graded on the server only
// (server/src/poker/), from a secret, and each one is sent when it is reached.

import { BRAND, GAMES } from '../brand.ts';
import { dailyNumber } from '../cards/daily.ts';

/** Hands in a day's run. */
export const POKER_DAILY_HANDS = 10;
/** Points for the best move in a hand. */
export const POKER_DAILY_MAX = 10;
/** The leaderboard's length. */
export const POKER_DAILY_TOP = 50;

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';
export type PokerPos = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type PokerMove = 'fold' | 'call' | 'raise' | 'allin';

/** One choice in a hand. Amounts are in big blinds. */
export interface PokerOption {
  /** "fold", "call", "raise", "allin". */
  id: string;
  kind: PokerMove;
  /** "Fold", "Call 4", "Raise to 13.5", "All-in 96". */
  label: string;
  /** What you put in from your stack with this move. */
  add: number;
}

/** One hand as the player sees it before answering: nothing about the answer. */
export interface PokerSpot {
  /** 0-based. */
  index: number;
  total: number;
  street: PokerStreet;
  /** Your two cards, "As" style. */
  hole: [string, string];
  /** The cards on the table so far. */
  board: string[];
  you: { pos: PokerPos; stack: number };
  villain: { pos: PokerPos; stack: number };
  /** In the middle now, the bet you face included. */
  pot: number;
  toCall: number;
  /** What happened so far, one short line each. */
  history: string[];
  /** The bet you face: "Villain bets 6 (2/3 pot)". */
  facing: string;
  /** What you have right now: "Pair", "Flush". */
  made: string;
  options: PokerOption[];
}

/** After answering: every option's EV and what the maths assumed. */
export interface PokerReveal {
  index: number;
  spot: PokerSpot;
  /** The option picked (null: not answered, the run was left). */
  choice: string | null;
  best: string;
  points: number;
  options: { id: string; label: string; ev: number; points: number; foldPct?: number; eqCalled?: number }[];
  /** Your share of the pot against his whole range, 0..1. */
  equity: number;
  /** The share you need to call (pot odds), 0..1. 0 when there is nothing to call. */
  needed: number;
  /** What his range is, in one line. */
  range: string;
  /** Hands in it (after the cards you can see). */
  combos: number;
  /** Thinking time for this hand, ms. */
  ms: number;
}

/** A finished (or left) official run. */
export interface PokerDailyResult {
  /** Out of 100. */
  points: number;
  /** Thinking time over the hands answered, ms. */
  timeMs: number;
  /** Points per hand, in order; -1: never answered (left). */
  grid: number[];
  /** Left before the end: the rest scored 0. */
  left?: boolean;
}

export interface PokerDailyRow extends PokerDailyResult {
  id: string;
  name: string;
  avatar?: string;
  endedAt: number;
  rank: number;
}

/** Most points first, then the quicker, then whoever finished first. */
export function comparePokerDaily(a: PokerDailyResult & { endedAt: number }, b: PokerDailyResult & { endedAt: number }): number {
  return b.points - a.points || a.timeMs - b.timeMs || a.endedAt - b.endedAt;
}

export const POKER_RANKING_HELP = 'Most points first. Equal points: the faster time wins (only time spent thinking counts).';

/**
 * Points for a move: 10 for the best EV. Otherwise points go down with the big
 * blinds the move gives away next to the best one, measured against the gap
 * between the best and the worst move (never less than 2 bb): give away the
 * whole gap and it scores 0.
 */
export function scoreMove(ev: number, evs: number[]): number {
  const best = Math.max(...evs);
  const worst = Math.min(...evs);
  const loss = best - ev;
  if (loss <= 1e-9) return POKER_DAILY_MAX;
  const scale = Math.max(best - worst, 2);
  return Math.max(0, Math.min(POKER_DAILY_MAX - 1, Math.round(POKER_DAILY_MAX * (1 - loss / scale))));
}

/** The scoring rule, in a sentence (under the reveal). */
export const POKER_SCORING_HELP = 'The best move scores 10. Other moves lose points for every big blind they give away compared with the best one.';

/** The share grid's square for a hand's points: best, close, off, wrong, not answered. */
export function gridSquare(p: number): string {
  if (p < 0) return '⬛';
  if (p >= 10) return '🟩';
  if (p >= 6) return '🟨';
  if (p >= 1) return '🟧';
  return '🟥';
}

/** "2m 14s" / "48s". */
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** "Chog Poker Daily #12". */
export function pokerDailyTitle(date: string): string {
  return `${BRAND.short} ${GAMES.poker.name} Daily #${dailyNumber(date)}`;
}

/** "Chog Poker Daily #12 — 87/100 🔥3", the grid, and the link. */
export function pokerShareText(o: { date: string; result: PokerDailyResult; streak?: number; url?: string }): string {
  const fire = o.streak ? ` 🔥${o.streak}` : '';
  const lines = [`${pokerDailyTitle(o.date)} — ${o.result.points}/100${fire}`, o.result.grid.map(gridSquare).join('')];
  if (o.url) lines.push(o.url);
  return lines.join('\n');
}

export interface PokerDailyStreaks {
  /** Days in a row with an official run, up to today (or yesterday while today is open). */
  streak: number;
  best: number;
}

export interface PokerDailyYou {
  /** none: not played today; playing: a run is under way; done: finished or left. */
  status: 'none' | 'playing' | 'done';
  /** Hands answered so far. */
  answered: number;
  result?: PokerDailyResult;
  rank?: number;
  streaks: PokerDailyStreaks;
}

/** GET /api/poker/daily: the day, its leaderboard and (signed in) where you stand. */
export interface PokerDailyInfo {
  date: string;
  number: number;
  today: string;
  endsAt: number;
  hands: number;
  players: number;
  leaders: PokerDailyRow[];
  you?: PokerDailyYou;
}

/** GET /api/poker/daily/history: the days before today, newest first. */
export interface PokerDailyDay {
  date: string;
  number: number;
  players: number;
  top: PokerDailyRow | null;
  you?: PokerDailyRow | null;
}

/** A run as the puzzle screen gets it (POST /api/poker/daily/play and /answer). */
export interface PokerRunView {
  mode: 'official' | 'practice';
  /** "official", or the practice run's id. */
  run: string;
  date: string;
  number: number;
  total: number;
  /** The hand to answer now (null once every hand is answered). */
  spot: PokerSpot | null;
  /** The hands answered so far, with their answers. */
  reveals: PokerReveal[];
  /** Official, once over: the result and where it placed. */
  result?: PokerDailyResult;
  rank?: number;
  of?: number;
  streak?: number;
}

/** The Poker Daily on a public profile. */
export interface PokerDailyProfile {
  played: number;
  /** Average points per official run. */
  average: number;
  streaks: PokerDailyStreaks;
  best: (PokerDailyRow & { date: string; number: number; of: number }) | null;
}
