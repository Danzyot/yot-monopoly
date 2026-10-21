// The Cards Daily Challenge (shared/cards/daily.ts): one seeded deal per UTC
// day, played solo against the day's bots. Each account gets one official
// attempt a day, recorded the moment it is dealt; anything after is practice
// and never ranked. Asking again while the official game is running goes back
// to that same game, and leaving it (or abandoning it until the table is
// swept) counts as a loss, so a bad start cannot be dealt again.
//
// Results are the room's (CardsRoom.dailyResult): worked out from the game on
// the server, never taken from a client. The day's seed is an HMAC of the
// date under a secret (CARDS_DAILY_SECRET, or one generated once and kept on
// the data volume), so the deal cannot be worked out ahead of time, nor
// searched for from the hand someone was dealt.

import { createHmac, randomBytes } from 'node:crypto';
import { debouncedWriter, readJson, writeJson } from '../jsonstore.ts';
import {
  CARDS_DAILY_BOT_LEVEL, CARDS_DAILY_RULES, CARDS_DAILY_TOP, addDays, compareDaily, dailyDate, dailyNumber, dailyStreaks,
  dayIndex, nextDailyAt,
  type CardsDailyDay, type CardsDailyInfo, type CardsDailyProfile, type CardsDailyResult, type CardsDailyRow, type CardsDailyStreaks,
} from '../../../shared/cards/daily.ts';
import { dailyBotNames, type CardsMember, type CardsRegistry, type CardsRoom } from './rooms.ts';

/** One account's official attempt on one day. No result yet: the game is still running. */
export interface CardsDailyAttempt {
  date: string;
  id: string;
  name: string;
  avatar?: string;
  /** The table it is (or was) played at. */
  code: string;
  startedAt: number;
  endedAt: number | null;
  result?: CardsDailyResult;
}

interface DailyFile {
  salt: string;
  attempts: CardsDailyAttempt[];
}

const FILE = 'cards-daily.json';
/** Attempts kept: about two years of a busy site. */
const MAX_ATTEMPTS = 200_000;
/** Days the history endpoint goes back, at most. */
export const DAILY_HISTORY_MAX = 60;

let salt = '';
let attempts: CardsDailyAttempt[] = [];
/** date → account id → attempt. */
const byDay = new Map<string, Map<string, CardsDailyAttempt>>();
const save = debouncedWriter(FILE, (): DailyFile => ({ salt, attempts }), 500);
let dirty = false;
const markDirty = () => { dirty = true; save(); };
// Monopoly's shutdown handler exits the process before a debounce would fire: write on the way out too.
process.once('exit', () => {
  if (!dirty) return;
  try { writeJson(FILE, { salt, attempts }); } catch (e) { console.error(`Could not save ${FILE}:`, e); }
});

function index(a: CardsDailyAttempt) {
  let day = byDay.get(a.date);
  if (!day) byDay.set(a.date, day = new Map());
  day.set(a.id, a);
}

export function loadCardsDaily(): void {
  const f = readJson<Partial<DailyFile>>(FILE, {});
  attempts = Array.isArray(f?.attempts) ? f.attempts.filter(a => a && typeof a.id === 'string' && typeof a.date === 'string') : [];
  byDay.clear();
  for (const a of attempts) index(a);
  salt = typeof f?.salt === 'string' && f.salt.length >= 16 ? f.salt : '';
  if (!salt) {
    salt = randomBytes(24).toString('hex');
    markDirty();
  }
}

/** The day's seed: secret, the same all day, different every day. */
export function cardsDailySeed(date: string): string {
  const key = process.env.CARDS_DAILY_SECRET || salt;
  return createHmac('sha256', key).update(`cards-daily:${date}`).digest('hex');
}

export function cardsDailyAttempt(date: string, id: string): CardsDailyAttempt | undefined {
  return byDay.get(date)?.get(id);
}

/** An unfinished attempt whose table is gone (a restart that lost it, a sweep): a walk-out. */
function abandon(a: CardsDailyAttempt, room: CardsRoom | undefined, now: number) {
  const d = room?.daily?.userId === a.id && !room.daily.practice ? room.daily : null;
  a.result = d?.result ?? { won: false, turns: d?.turns ?? 0, points: 0, handPoints: 0, cards: 0, oppCards: 0, left: true };
  a.endedAt = now;
  markDirty();
}

/** The table an unfinished attempt is still being played at, if it is. */
function liveRoom(a: CardsDailyAttempt, registry: CardsRegistry): CardsRoom | null {
  const room = registry.get(a.code);
  return room?.daily && room.daily.userId === a.id && !room.daily.practice && room.status === 'playing' ? room : null;
}

/** Settle attempts left unfinished by tables that are gone (at boot, and before answering about them). */
export function reconcileCardsDaily(registry: CardsRegistry, now = Date.now(), only?: CardsDailyAttempt): void {
  for (const a of only ? [only] : attempts) {
    if (a.result || liveRoom(a, registry)) continue;
    abandon(a, registry.get(a.code), now);
  }
}

export interface StartedDaily {
  room: CardsRoom;
  practice: boolean;
  /** Back at the official game already under way. */
  resumed: boolean;
}

/**
 * "Play the Daily Challenge": the official attempt the first time today; the
 * same game again while it is still running; a practice deal of the same
 * cards after that.
 */
export function startCardsDaily(
  registry: CardsRegistry, m: CardsMember,
  opts: { chogToken?: number; exempt?: boolean; taken?: (code: string) => boolean; now?: number } = {},
): StartedDaily {
  const now = opts.now ?? Date.now();
  const date = dailyDate(now);
  const a = cardsDailyAttempt(date, m.id);
  if (a && !a.result) {
    const live = liveRoom(a, registry);
    if (live) return { room: live, practice: false, resumed: true };
    abandon(a, registry.get(a.code), now);
  }
  const practice = !!a;
  // The official deal is never refused for opening too many tables; practice is.
  const room = registry.create(m.id, opts.exempt || !practice, opts.taken);
  try {
    room.setupDaily({ date, seed: cardsDailySeed(date), practice }, m, opts.chogToken);
  } catch (e) {
    registry.delete(room.code);
    throw e;
  }
  if (!practice) {
    const fresh: CardsDailyAttempt = { date, id: m.id, name: m.name, avatar: m.avatar, code: room.code, startedAt: now, endedAt: null };
    attempts.push(fresh);
    index(fresh);
    if (attempts.length > MAX_ATTEMPTS) {
      const gone = attempts.splice(0, attempts.length - MAX_ATTEMPTS);
      for (const g of gone) byDay.get(g.date)?.delete(g.id);
    }
    markDirty();
  }
  return { room, practice, resumed: false };
}

/**
 * A daily table's match finished or was stopped: record the official result
 * (practice is never recorded), and put the rank and streak on the table for
 * its result screen.
 */
export function settleCardsDaily(room: CardsRoom, now = Date.now()): CardsDailyAttempt | null {
  const d = room.daily;
  if (!d || d.practice || !d.result) return null;
  const a = cardsDailyAttempt(d.date, d.userId);
  if (!a || a.code !== room.code) return null;
  if (!a.result) {
    a.result = d.result;
    a.endedAt = now;
    markDirty();
  }
  const rows = dayRows(d.date);
  d.rank = rows.find(r => r.id === a.id)?.rank;
  d.of = rows.length;
  d.streak = streaksOf(a.id, d.date).streak;
  room.dirty = true;
  return a;
}

/** A finished attempt as a leaderboard row (rank to be filled in). */
const toRow = (a: CardsDailyAttempt): CardsDailyRow => ({
  id: a.id, name: a.name, ...(a.avatar && { avatar: a.avatar }), endedAt: a.endedAt ?? a.startedAt, rank: 0, ...a.result!,
});

/** Every finished official attempt that day, best first, ranked. */
function dayRows(date: string): CardsDailyRow[] {
  const rows = [...(byDay.get(date)?.values() ?? [])].filter(a => a.result).map(toRow).sort(compareDaily);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function cardsDailyLeaders(date: string, limit = CARDS_DAILY_TOP): CardsDailyRow[] {
  return dayRows(date).slice(0, limit);
}

function streaksOf(id: string, today: string): CardsDailyStreaks {
  const played: string[] = [];
  const won: string[] = [];
  for (const a of attempts) {
    if (a.id !== id) continue;
    played.push(a.date);
    if (a.result?.won) won.push(a.date);
  }
  return dailyStreaks(played, won, today);
}

/** GET /api/cards/daily: one day's table and leaderboard, and (signed in) where you stand. */
export function cardsDailyInfo(date: string, opts: { userId?: string; now?: number; leaders?: boolean } = {}): CardsDailyInfo {
  const now = opts.now ?? Date.now();
  const today = dailyDate(now);
  const rows = dayRows(date);
  const info: CardsDailyInfo = {
    date, number: dailyNumber(date), today,
    endsAt: date === today ? nextDailyAt(now) : (dayIndex(date) + 1) * 86_400_000,
    bots: dailyBotNames(cardsDailySeed(date)).map(name => ({ name, level: CARDS_DAILY_BOT_LEVEL })),
    rules: { ...CARDS_DAILY_RULES },
    players: rows.length,
    wins: rows.filter(r => r.won).length,
    leaders: opts.leaders === false ? [] : rows.slice(0, CARDS_DAILY_TOP),
  };
  if (opts.userId) {
    const a = cardsDailyAttempt(date, opts.userId);
    const mine = rows.find(r => r.id === opts.userId);
    info.you = {
      status: !a ? 'none' : a.result ? 'done' : 'playing',
      ...(a && !a.result && { code: a.code }),
      ...(a?.result && { result: a.result }),
      ...(mine && { rank: mine.rank }),
      streaks: streaksOf(opts.userId, today),
    };
  }
  return info;
}

/** GET /api/cards/daily/history: the days before today, newest first. */
export function cardsDailyHistory(opts: { days?: number; userId?: string; now?: number } = {}): CardsDailyDay[] {
  const today = dailyDate(opts.now ?? Date.now());
  const n = Math.min(DAILY_HISTORY_MAX, Math.max(1, Math.floor(opts.days ?? 14)));
  const out: CardsDailyDay[] = [];
  for (let k = 1; k <= n; k++) {
    const date = addDays(today, -k);
    if (dailyNumber(date) < 1) break;
    const rows = dayRows(date);
    out.push({
      date, number: dailyNumber(date), players: rows.length, wins: rows.filter(r => r.won).length, top: rows[0] ?? null,
      ...(opts.userId && { you: rows.find(r => r.id === opts.userId) ?? null }),
    });
  }
  return out;
}

/** The Daily Challenge half of a profile: streaks and the best result ever. Null before a first attempt. */
export function cardsDailyProfile(id: string, now = Date.now()): CardsDailyProfile | null {
  const mine = attempts.filter(a => a.id === id);
  if (!mine.length) return null;
  const today = dailyDate(now);
  let best: CardsDailyProfile['best'] = null;
  for (const a of mine) {
    if (!a.result) continue;
    const rows = dayRows(a.date);
    const row = rows.find(r => r.id === id)!;
    if (!best || compareDaily(row, best) < 0) best = { ...row, date: a.date, number: dailyNumber(a.date), of: rows.length };
  }
  return {
    played: mine.length,
    wins: mine.filter(a => a.result?.won).length,
    streaks: streaksOf(id, today),
    best,
  };
}

/** A deleted player (../erase.ts): their attempts go (nobody else's rank depends on a row of theirs being kept). */
export function eraseCardsDaily(id: string): number {
  const before = attempts.length;
  attempts = attempts.filter(a => a.id !== id);
  for (const day of byDay.values()) day.delete(id);
  const n = before - attempts.length;
  if (n) markDirty();
  return n;
}

/** Every official attempt on record, oldest first (the dashboard's Analytics tab counts them). */
export function allCardsDailyAttempts(): readonly CardsDailyAttempt[] {
  return attempts;
}

/** For tests: forget everything (the salt included, unless one is set). */
export function resetCardsDaily(): void {
  attempts = [];
  byDay.clear();
  salt = randomBytes(24).toString('hex');
  dirty = false;
}
