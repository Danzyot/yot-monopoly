// The Monopoly Daily Challenge: one seeded game per UTC day that everyone
// plays solo against the same three bots, on the day's board, for at most
// MONOPOLY_DAILY_TURNS of their own turns. What client and server agree on
// lives here: the day's number, board and rules, how results rank, streaks
// and the share line. The seed itself is the server's
// (server/src/monopolyDaily.ts): it is salted with a secret, so nobody can
// work out the day's dice or cards ahead of time.
//
// The calendar (UTC dates, day numbers, streaks) is the Cards daily's
// (shared/cards/daily.ts), so a page that shows both lines them up.

import { BRAND, GAMES } from './brand.ts';
import { getMap } from './maps.ts';
import { DEFAULT_RULES, type RuleConfig } from './themes.ts';
import {
  addDays, dailyDate, dailyStreaks, dayIndex, isDailyDate, nextDailyAt, type CardsDailyStreaks,
} from './cards/daily.ts';

export { addDays, dailyDate, dailyStreaks, dayIndex, isDailyDate, nextDailyAt };
export type MonopolyDailyStreaks = CardsDailyStreaks;

/** Daily #1. */
export const MONOPOLY_DAILY_EPOCH = '2026-10-21';
/** Bots at the daily table (with the player: four seats). */
export const MONOPOLY_DAILY_BOTS = 3;
/** The game ends when the player has had this many turns: richest wins. */
export const MONOPOLY_DAILY_TURNS = 20;
/** The leaderboard's length. */
export const MONOPOLY_DAILY_TOP = 50;
/** Seconds per step of a turn. Three steps in a row run out and the attempt is over (idle = a loss). */
export const MONOPOLY_DAILY_TURN_SECONDS = 45;

/**
 * The board each UTC weekday (0 = Sunday): every board in turn, the quick
 * ones (Blitz, Speedway) twice a week.
 */
export const MONOPOLY_DAILY_BOARDS: readonly string[] = ['blitz', 'classic', 'speed', 'crossroads', 'blitz', 'metropolis', 'speed'];

/** "Daily #12": counted from MONOPOLY_DAILY_EPOCH (#1). */
export function monopolyDailyNumber(date: string): number {
  return dayIndex(date) - dayIndex(MONOPOLY_DAILY_EPOCH) + 1;
}

/** The day's board (its map id). */
export function monopolyDailyMap(date: string): string {
  const d = dayIndex(date);
  // 1970-01-01 was a Thursday (weekday 4).
  const weekday = Number.isFinite(d) ? (((d + 4) % 7) + 7) % 7 : 1;
  return MONOPOLY_DAILY_BOARDS[weekday];
}

/**
 * The daily's house rules: the standard rules with the board's own economy
 * (Blitz: its salary, starting cash and jackpot), four seats, no arcade
 * rounds, no Speed Die, no game clock (the turn cap ends it) and a
 * MONOPOLY_DAILY_TURN_SECONDS turn timer. Nobody can change them.
 */
export function monopolyDailyRules(mapId: string): RuleConfig {
  const map = getMap(mapId);
  return {
    ...DEFAULT_RULES,
    ...map.rules,
    goSalary: map.goSalary ?? DEFAULT_RULES.goSalary,
    startingCash: map.startingCash ?? DEFAULT_RULES.startingCash,
    maxPlayers: 1 + MONOPOLY_DAILY_BOTS,
    minigames: false,
    arcadeParking: false,
    speedDie: false,
    timeLimitMin: 0,
    turnSeconds: MONOPOLY_DAILY_TURN_SECONDS,
  };
}

/** One official attempt's outcome, worked out by the server when the game ends. */
export interface MonopolyDailyResult {
  /** Every bot went broke: the player is the last one standing. */
  won: boolean;
  /** Turns the player took. */
  turns: number;
  /** The player's net worth at the end (cash, deeds at price, buildings at cost). 0 once broke. */
  netWorth: number;
  /** 1–4 at the table at the end, by the game's own standings. */
  place: number;
  /** Bots that went broke. */
  botsOut: number;
  /** The player went broke before the turns ran out. */
  bankrupt?: boolean;
  /** Left, went idle, or abandoned the attempt: a loss, ranked below every other result. */
  left?: boolean;
}

export interface MonopolyDailyRow extends MonopolyDailyResult {
  id: string;
  name: string;
  avatar?: string;
  endedAt: number;
  /** 1-based place on the day's leaderboard. */
  rank: number;
}

/** How a result sorts: 0 won, 1 finished the turns, 2 went broke, 3 left. */
function tier(r: MonopolyDailyResult): number {
  return r.won ? 0 : r.left ? 3 : r.bankrupt ? 2 : 1;
}

/**
 * How a day's results rank: wins first (fewest turns, then most money). Then
 * everyone who played all their turns, by net worth (ties: fewer turns). Then
 * anyone who went broke (the longer they lasted the better), and walk-outs
 * last. Any tie left goes to whoever finished first.
 */
export function compareMonopolyDaily(a: MonopolyDailyResult & { endedAt: number }, b: MonopolyDailyResult & { endedAt: number }): number {
  const t = tier(a) - tier(b);
  if (t) return t;
  if (a.won) return a.turns - b.turns || b.netWorth - a.netWorth || a.endedAt - b.endedAt;
  if (a.left) return a.endedAt - b.endedAt;
  if (a.bankrupt) return b.turns - a.turns || a.endedAt - b.endedAt;
  return b.netWorth - a.netWorth || a.turns - b.turns || a.endedAt - b.endedAt;
}

/** The rules of the day, in two plain sentences (on the card and under the leaderboard). */
export const MONOPOLY_DAILY_HOW = `Everyone gets the same game today. Beat ${MONOPOLY_DAILY_BOTS} bots — or finish richest after ${MONOPOLY_DAILY_TURNS} turns. You get one try.`;
export const MONOPOLY_DAILY_RANKING_HELP = `A win (all ${MONOPOLY_DAILY_BOTS} bots broke) beats everything — fewer turns is better. `
  + `Otherwise, the most money (cash plus property) after ${MONOPOLY_DAILY_TURNS} turns. Going broke or leaving puts you at the bottom.`;

/** "$2,340". */
export function dailyMoney(n: number, currency = '$'): string {
  return `${n < 0 ? '-' : ''}${currency}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

/** "won in 14 turns" / "finished with $2,340" / "went broke on turn 9" / "walked out". */
export function monopolyDailyOutcome(r: MonopolyDailyResult, currency = '$'): string {
  if (r.won) return `won in ${r.turns} turn${r.turns === 1 ? '' : 's'}`;
  if (r.left) return 'walked out';
  if (r.bankrupt) return `went broke on turn ${r.turns}`;
  return `finished with ${dailyMoney(r.netWorth, currency)}`;
}

/** The game's daily, by name: "Chog Monopoly Daily #12". */
export function monopolyDailyTitle(date: string): string {
  return `${BRAND.short} ${GAMES.monopoly.name} Daily #${monopolyDailyNumber(date)}`;
}

/** The share line: "Chog Monopoly Daily #12 — won on Blitz in 14 turns 🔥3", the details, and the link. */
export function monopolyDailyShareText(o: {
  date: string; result: MonopolyDailyResult; streak?: number; rank?: number; of?: number; url?: string; currency?: string;
}): string {
  const r = o.result;
  const board = getMap(monopolyDailyMap(o.date)).name;
  const fire = o.streak ? ` 🔥${o.streak}` : '';
  const what = r.won ? `won on ${board} in ${r.turns} turn${r.turns === 1 ? '' : 's'}`
    : `${monopolyDailyOutcome(r, o.currency)} on ${board}`;
  const lines = [`${monopolyDailyTitle(o.date)} — ${what}${fire}`];
  const facts = [r.won ? `🏆 ${dailyMoney(r.netWorth, o.currency)}` : `🎩 ${ordinal(r.place)} of 4 · ${r.botsOut} bot${r.botsOut === 1 ? '' : 's'} broke`];
  if (o.rank && o.of) facts.push(`#${o.rank} of ${o.of}`);
  lines.push(facts.join(' · '));
  if (o.url) lines.push(o.url);
  return lines.join('\n');
}

/** 1st, 2nd, 3rd, 4th. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** GET /api/monopoly/daily: today's (or one past day's) game, your status and the top of the leaderboard. */
export interface MonopolyDailyInfo {
  date: string;
  number: number;
  /** Today's date on the server (the asked-for date may be an earlier one). */
  today: string;
  /** When today's game ends (the next UTC midnight). */
  endsAt: number;
  /** The day's board. */
  mapId: string;
  /** Turns the player gets. */
  turns: number;
  bots: { name: string }[];
  rules: RuleConfig;
  /** Official attempts finished (or walked out of) that day. */
  players: number;
  wins: number;
  leaders: MonopolyDailyRow[];
  /** Signed in only. */
  you?: MonopolyDailyYou;
}

export interface MonopolyDailyYou {
  /** none: not played; playing: the official attempt is under way (code to go back to it). */
  status: 'none' | 'playing' | 'done';
  code?: string;
  result?: MonopolyDailyResult;
  rank?: number;
  streaks: MonopolyDailyStreaks;
}

/** GET /api/monopoly/daily/history: the past days, newest first. */
export interface MonopolyDailyDay {
  date: string;
  number: number;
  mapId: string;
  players: number;
  wins: number;
  /** The day's best (the top row), if anyone played. */
  top: MonopolyDailyRow | null;
  /** Signed in: your own row that day. */
  you?: MonopolyDailyRow | null;
}

/** The Daily Challenge on a public profile (PublicProfile.daily). */
export interface MonopolyDailyProfile {
  played: number;
  wins: number;
  streaks: MonopolyDailyStreaks;
  /** Their best official result ever, by the leaderboard's order, with where it placed that day. */
  best: (MonopolyDailyRow & { date: string; number: number; of: number; mapId: string }) | null;
}

/** On a daily table's room view: which day, official or practice, the turn count and (once over) the result. */
export interface MonopolyDailyTableInfo {
  date: string;
  number: number;
  practice: boolean;
  /** The player's turns so far, and how many they get. */
  turns: number;
  maxTurns: number;
  result?: MonopolyDailyResult;
  /** Official only, once recorded. */
  rank?: number;
  of?: number;
  streak?: number;
}
