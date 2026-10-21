// The Monopoly Daily Challenge (shared/monopolyDaily.ts): one seeded game per
// UTC day on the day's board, played solo against the day's three bots for at
// most MONOPOLY_DAILY_TURNS turns. Each account gets one official attempt a
// day, recorded the moment it starts; anything after is practice and never
// ranked. Asking again while the official game is running goes back to that
// same game, and leaving it, going idle, or abandoning it until the table is
// swept counts as a loss, so a bad start cannot be played again.
//
// Results are the room's (Room.dailyResult): worked out from the game on the
// server, never taken from a client. The day's seed is an HMAC of the date
// under a secret (MONOPOLY_DAILY_SECRET, or one generated once and kept on
// the data volume), so the dice and the cards cannot be worked out ahead of
// time, nor searched for from the first rolls someone saw.
//
// The Cards daily (cards/daily.ts) works the same way; the two stay separate
// stores so each game's rules can move on its own.

import { createHmac, randomBytes } from 'node:crypto';
import { debouncedWriter, readJson, writeJson } from './jsonstore.ts';
import {
  MONOPOLY_DAILY_TOP, MONOPOLY_DAILY_TURNS, addDays, compareMonopolyDaily, dailyDate, dailyStreaks, dayIndex,
  monopolyDailyMap, monopolyDailyNumber, monopolyDailyRules, nextDailyAt,
  type MonopolyDailyDay, type MonopolyDailyInfo, type MonopolyDailyProfile, type MonopolyDailyResult,
  type MonopolyDailyRow, type MonopolyDailyStreaks,
} from '../../shared/monopolyDaily.ts';
import { monopolyDailyBotNames, type Member, type Registry, type Room } from './rooms.ts';

/** One account's official attempt on one day. No result yet: the game is still running. */
export interface MonopolyDailyAttempt {
  date: string;
  id: string;
  name: string;
  avatar?: string;
  /** The table it is (or was) played at. */
  code: string;
  startedAt: number;
  endedAt: number | null;
  result?: MonopolyDailyResult;
}

interface DailyFile {
  salt: string;
  attempts: MonopolyDailyAttempt[];
}

const FILE = 'monopoly-daily.json';
/** Attempts kept: about two years of a busy site. */
const MAX_ATTEMPTS = 200_000;
/** Days the history endpoint goes back, at most. */
export const DAILY_HISTORY_MAX = 60;

let salt = '';
let attempts: MonopolyDailyAttempt[] = [];
/** date → account id → attempt. */
const byDay = new Map<string, Map<string, MonopolyDailyAttempt>>();
const save = debouncedWriter(FILE, (): DailyFile => ({ salt, attempts }), 500);
let dirty = false;
const markDirty = () => { dirty = true; save(); };
// The shutdown handler exits the process before a debounce would fire: write on the way out too.
process.once('exit', () => {
  if (!dirty) return;
  try { writeJson(FILE, { salt, attempts }); } catch (e) { console.error(`Could not save ${FILE}:`, e); }
});

function index(a: MonopolyDailyAttempt) {
  let day = byDay.get(a.date);
  if (!day) byDay.set(a.date, day = new Map());
  day.set(a.id, a);
}

export function loadMonopolyDaily(): void {
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
export function monopolyDailySeed(date: string): string {
  const key = process.env.MONOPOLY_DAILY_SECRET || salt;
  return createHmac('sha256', key).update(`monopoly-daily:${date}`).digest('hex');
}

export function monopolyDailyAttempt(date: string, id: string): MonopolyDailyAttempt | undefined {
  return byDay.get(date)?.get(id);
}

/** An unfinished attempt whose table is gone (a restart that lost it, a sweep): a walk-out. */
function abandon(a: MonopolyDailyAttempt, room: Room | undefined, now: number) {
  const d = room?.daily?.userId === a.id && !room.daily.practice ? room.daily : null;
  a.result = d?.result ?? { won: false, turns: d?.turns ?? 0, netWorth: 0, place: 4, botsOut: 0, left: true };
  a.endedAt = now;
  markDirty();
}

/** The table an unfinished attempt is still being played at, if it is. */
function liveRoom(a: MonopolyDailyAttempt, registry: Registry): Room | null {
  const room = registry.get(a.code);
  return room?.daily && room.daily.userId === a.id && !room.daily.practice && room.status === 'playing' ? room : null;
}

/** Settle attempts left unfinished by tables that are gone (at boot, and before answering about them). */
export function reconcileMonopolyDaily(registry: Registry, now = Date.now()): void {
  for (const a of attempts) {
    if (a.result || liveRoom(a, registry)) continue;
    abandon(a, registry.get(a.code), now);
  }
}

export interface StartedDaily {
  room: Room;
  practice: boolean;
  /** Back at the official game already under way. */
  resumed: boolean;
}

/**
 * "Play the Daily Challenge": the official attempt the first time today; the
 * same game again while it is still running; a practice game of the same
 * day after that.
 */
export function startMonopolyDaily(
  registry: Registry, m: Member, opts: { exempt?: boolean; now?: number } = {},
): StartedDaily {
  const now = opts.now ?? Date.now();
  const date = dailyDate(now);
  const a = monopolyDailyAttempt(date, m.id);
  if (a && !a.result) {
    const live = liveRoom(a, registry);
    if (live) return { room: live, practice: false, resumed: true };
    abandon(a, registry.get(a.code), now);
  }
  const practice = !!a;
  // The official game is never refused for opening too many rooms; practice is.
  const room = registry.create(m.id, opts.exempt || !practice);
  try {
    room.setupDaily({ date, seed: monopolyDailySeed(date), practice }, m);
  } catch (e) {
    registry.delete(room.code);
    throw e;
  }
  if (!practice) {
    const fresh: MonopolyDailyAttempt = { date, id: m.id, name: m.name, avatar: m.avatar, code: room.code, startedAt: now, endedAt: null };
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
 * A daily table's game finished or was stopped: record the official result
 * (practice is never recorded), and put the rank and streak on the table for
 * its result screen.
 */
export function settleMonopolyDaily(room: Room, now = Date.now()): MonopolyDailyAttempt | null {
  const d = room.daily;
  if (!d || d.practice || !d.result) return null;
  const a = monopolyDailyAttempt(d.date, d.userId);
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
const toRow = (a: MonopolyDailyAttempt): MonopolyDailyRow => ({
  id: a.id, name: a.name, ...(a.avatar && { avatar: a.avatar }), endedAt: a.endedAt ?? a.startedAt, rank: 0, ...a.result!,
});

/** Every finished official attempt that day, best first, ranked. */
function dayRows(date: string): MonopolyDailyRow[] {
  const rows = [...(byDay.get(date)?.values() ?? [])].filter(a => a.result).map(toRow).sort(compareMonopolyDaily);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function monopolyDailyLeaders(date: string, limit = MONOPOLY_DAILY_TOP): MonopolyDailyRow[] {
  return dayRows(date).slice(0, limit);
}

function streaksOf(id: string, today: string): MonopolyDailyStreaks {
  const played: string[] = [];
  const won: string[] = [];
  for (const a of attempts) {
    if (a.id !== id) continue;
    played.push(a.date);
    if (a.result?.won) won.push(a.date);
  }
  return dailyStreaks(played, won, today);
}

/** GET /api/monopoly/daily: one day's game and leaderboard, and (signed in) where you stand. */
export function monopolyDailyInfo(date: string, opts: { userId?: string; now?: number; leaders?: boolean } = {}): MonopolyDailyInfo {
  const now = opts.now ?? Date.now();
  const today = dailyDate(now);
  const rows = dayRows(date);
  const mapId = monopolyDailyMap(date);
  const info: MonopolyDailyInfo = {
    date, number: monopolyDailyNumber(date), today,
    endsAt: date === today ? nextDailyAt(now) : (dayIndex(date) + 1) * 86_400_000,
    mapId,
    turns: MONOPOLY_DAILY_TURNS,
    bots: monopolyDailyBotNames(monopolyDailySeed(date)).map(name => ({ name })),
    rules: monopolyDailyRules(mapId),
    players: rows.length,
    wins: rows.filter(r => r.won).length,
    leaders: opts.leaders === false ? [] : rows.slice(0, MONOPOLY_DAILY_TOP),
  };
  if (opts.userId) {
    const a = monopolyDailyAttempt(date, opts.userId);
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

/** GET /api/monopoly/daily/history: the days before today, newest first. */
export function monopolyDailyHistory(opts: { days?: number; userId?: string; now?: number } = {}): MonopolyDailyDay[] {
  const today = dailyDate(opts.now ?? Date.now());
  const n = Math.min(DAILY_HISTORY_MAX, Math.max(1, Math.floor(opts.days ?? 14)));
  const out: MonopolyDailyDay[] = [];
  for (let k = 1; k <= n; k++) {
    const date = addDays(today, -k);
    if (monopolyDailyNumber(date) < 1) break;
    const rows = dayRows(date);
    out.push({
      date, number: monopolyDailyNumber(date), mapId: monopolyDailyMap(date),
      players: rows.length, wins: rows.filter(r => r.won).length, top: rows[0] ?? null,
      ...(opts.userId && { you: rows.find(r => r.id === opts.userId) ?? null }),
    });
  }
  return out;
}

/** The Daily Challenge part of a profile: streaks and the best result ever. Null before a first attempt. */
export function monopolyDailyProfile(id: string, now = Date.now()): MonopolyDailyProfile | null {
  const mine = attempts.filter(a => a.id === id);
  if (!mine.length) return null;
  const today = dailyDate(now);
  let best: MonopolyDailyProfile['best'] = null;
  for (const a of mine) {
    if (!a.result) continue;
    const rows = dayRows(a.date);
    const row = rows.find(r => r.id === id)!;
    if (!best || compareMonopolyDaily(row, best) < 0) {
      best = { ...row, date: a.date, number: monopolyDailyNumber(a.date), of: rows.length, mapId: monopolyDailyMap(a.date) };
    }
  }
  return {
    played: mine.length,
    wins: mine.filter(a => a.result?.won).length,
    streaks: streaksOf(id, today),
    best,
  };
}

/** A deleted player (./erase.ts): their attempts go (nobody else's rank depends on a row of theirs being kept). */
export function eraseMonopolyDaily(id: string): number {
  const before = attempts.length;
  attempts = attempts.filter(a => a.id !== id);
  for (const day of byDay.values()) day.delete(id);
  const n = before - attempts.length;
  if (n) markDirty();
  return n;
}

/** For tests: forget everything (the salt included, unless one is set). */
export function resetMonopolyDaily(): void {
  attempts = [];
  byDay.clear();
  salt = randomBytes(24).toString('hex');
  dirty = false;
}
