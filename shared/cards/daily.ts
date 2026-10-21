// The Cards Daily Challenge: one seeded deal per UTC day that everyone plays
// solo against the same bots. What client and server agree on lives here: the
// day's number and table, how results rank, streaks, and the share line. The
// seed itself is the server's (server/src/cards/daily.ts): it is salted with a
// secret so nobody can deal the day's cards out ahead of time.

import { BRAND } from '../brand.ts';
import { CARDS_GAME_NAME } from './meta.ts';
import { CARDS_MODES, DEFAULT_CARDS_RULES, type CardsRules } from './rules.ts';
import type { CardsBotLevel } from './types.ts';

/** Daily #1. */
export const CARDS_DAILY_EPOCH = '2026-10-21';
/** Bots at the daily table (with the player: four seats). */
export const CARDS_DAILY_BOTS = 3;
/** Every daily bot plays at this level. */
export const CARDS_DAILY_BOT_LEVEL: CardsBotLevel = 'normal';
/** The leaderboard's length. */
export const CARDS_DAILY_TOP = 50;
/** Classic, one round, stacking (the Classic preset), the usual 30 s turn timer. */
export const CARDS_DAILY_RULES: CardsRules = {
  ...DEFAULT_CARDS_RULES,
  ...CARDS_MODES.find(m => m.id === 'classic')!.preset,
  mode: 'classic',
  match: 'single',
  turnSeconds: 30,
};

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC date `t` falls on, as YYYY-MM-DD. */
export function dailyDate(t: number = Date.now()): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 for a YYYY-MM-DD date (NaN when it is not one). */
export function dayIndex(date: string): number {
  if (!DATE_RE.test(date)) return NaN;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && dailyDate(t) === date ? Math.round(t / DAY_MS) : NaN;
}

export function isDailyDate(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(dayIndex(v));
}

/** The date `n` days after `date` (before, when negative). */
export function addDays(date: string, n: number): string {
  return dailyDate((dayIndex(date) + n) * DAY_MS);
}

/** "Daily #12": counted from CARDS_DAILY_EPOCH (#1). */
export function dailyNumber(date: string): number {
  return dayIndex(date) - dayIndex(CARDS_DAILY_EPOCH) + 1;
}

/** When the next daily deal starts (the next UTC midnight). */
export function nextDailyAt(t: number = Date.now()): number {
  return (Math.floor(t / DAY_MS) + 1) * DAY_MS;
}

/** One official attempt's outcome, worked out by the server when the round ends. */
export interface CardsDailyResult {
  won: boolean;
  /** Turns the player took (each time play came round to them). */
  turns: number;
  /** A win: the round's points, everything left in the bots' hands. A loss: 0. */
  points: number;
  /** A loss: the points still in the player's hand (0 on a win). */
  handPoints: number;
  /** Cards still in the player's hand. */
  cards: number;
  /** Cards left in the bots' hands at the end. */
  oppCards: number;
  /** Left (or abandoned) the attempt: a loss, ranked below every finished one. */
  left?: boolean;
}

export interface CardsDailyRow extends CardsDailyResult {
  id: string;
  name: string;
  avatar?: string;
  endedAt: number;
  /** 1-based place on the day's leaderboard. */
  rank: number;
}

/**
 * How a day's results rank: every win above every loss. Wins by fewest turns,
 * then most points scored (the bots' leftover cards); losses by fewest points
 * left in hand, then fewest cards, with walk-outs last. Ties go to whoever
 * finished first.
 */
export function compareDaily(a: CardsDailyResult & { endedAt: number }, b: CardsDailyResult & { endedAt: number }): number {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.won) return a.turns - b.turns || b.points - a.points || a.endedAt - b.endedAt;
  if (a.left || b.left) return Number(!!a.left) - Number(!!b.left) || a.endedAt - b.endedAt;
  return a.handPoints - b.handPoints || a.cards - b.cards || a.endedAt - b.endedAt;
}

/** The ranking rule, in a sentence (under the leaderboard). */
export const DAILY_RANKING_HELP = 'Wins first, by fewest turns, then most points left in the bots’ hands. Losses rank by fewest points left in your own hand.';

export interface CardsDailyStreaks {
  /** Days in a row with an official attempt, up to today (or yesterday, while today is still open). */
  streak: number;
  best: number;
  /** Days in a row won, the same way. */
  winStreak: number;
  bestWin: number;
}

/** The current run of consecutive days in `days` that reaches today, or yesterday (today is not over yet). */
function runs(days: Set<number>, today: number): { current: number; best: number } {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const d of sorted) {
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let d = days.has(today) ? today : today - 1;
  while (days.has(d)) { current++; d--; }
  return { current, best };
}

/** Streaks from the dates someone played (and won) the official daily. */
export function dailyStreaks(played: Iterable<string>, won: Iterable<string>, today: string): CardsDailyStreaks {
  const idx = (it: Iterable<string>) => new Set([...it].map(dayIndex).filter(Number.isFinite));
  const t = dayIndex(today);
  const p = runs(idx(played), t);
  const wonDays = idx(won);
  const w = runs(wonDays, t);
  // A loss today breaks the win streak at once, even though today is not over.
  const lostToday = idx(played).has(t) && !wonDays.has(t);
  return { streak: p.current, best: p.best, winStreak: lostToday ? 0 : w.current, bestWin: w.best };
}

/** "won in 14 turns" / "lost with 23 points in hand" / "walked out". */
export function dailyOutcome(r: CardsDailyResult): string {
  if (r.won) return `won in ${r.turns} turn${r.turns === 1 ? '' : 's'}`;
  if (r.left) return 'walked out';
  return `lost with ${r.handPoints} point${r.handPoints === 1 ? '' : 's'} in hand`;
}

/** The game's daily, by name: "Chog Cards Daily #12". */
export function dailyTitle(date: string): string {
  return `${BRAND.short} ${CARDS_GAME_NAME} Daily #${dailyNumber(date)}`;
}

/** The Wordle-style share: "Chog Cards Daily #12 — won in 14 turns 🔥3", the details, and the link. */
export function dailyShareText(o: { date: string; result: CardsDailyResult; streak?: number; rank?: number; of?: number; url?: string }): string {
  const r = o.result;
  const fire = o.streak ? ` 🔥${o.streak}` : '';
  const lines = [`${dailyTitle(o.date)} — ${dailyOutcome(r)}${fire}`];
  const facts = [r.won ? `🏆 +${r.points} pts` : `🃏 ${r.cards} card${r.cards === 1 ? '' : 's'} left`];
  if (o.rank && o.of) facts.push(`#${o.rank} of ${o.of}`);
  lines.push(facts.join(' · '));
  if (o.url) lines.push(o.url);
  return lines.join('\n');
}

/** GET /api/cards/daily: today's (or one past day's) table, your status and the top of the leaderboard. */
export interface CardsDailyInfo {
  date: string;
  number: number;
  /** Today's date on the server (the asked-for date may be an earlier one). */
  today: string;
  /** When today's deal ends (the next UTC midnight). */
  endsAt: number;
  bots: { name: string; level: CardsBotLevel }[];
  rules: CardsRules;
  /** Official attempts finished (or walked out of) that day. */
  players: number;
  wins: number;
  leaders: CardsDailyRow[];
  /** Signed in only. */
  you?: CardsDailyYou;
}

export interface CardsDailyYou {
  /** none: not played; playing: the official attempt is under way (code to go back to it). */
  status: 'none' | 'playing' | 'done';
  code?: string;
  result?: CardsDailyResult;
  rank?: number;
  streaks: CardsDailyStreaks;
}

/** GET /api/cards/daily/history: the past days, newest first. */
export interface CardsDailyDay {
  date: string;
  number: number;
  players: number;
  wins: number;
  /** The day's winner (the top row), if anyone played. */
  top: CardsDailyRow | null;
  /** Signed in: your own row that day. */
  you?: CardsDailyRow | null;
}

/** The Daily Challenge on a public profile (CardsProfile.daily). */
export interface CardsDailyProfile {
  played: number;
  wins: number;
  streaks: CardsDailyStreaks;
  /** Their best official result ever, by the leaderboard's order, with where it placed that day. */
  best: (CardsDailyRow & { date: string; number: number; of: number }) | null;
}

/** On a daily table's room view: which day, official or practice, and (once over) the result. */
export interface CardsDailyTableInfo {
  date: string;
  number: number;
  practice: boolean;
  /** The player's turns so far. */
  turns: number;
  result?: CardsDailyResult;
  /** Official only, once recorded. */
  rank?: number;
  of?: number;
  streak?: number;
}
