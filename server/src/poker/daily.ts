// The Poker Daily, "Daily Hands" (shared/poker/daily.ts): ten poker decisions
// a day, the same for everyone, dealt and graded here (./spots.ts).
//
// Secrecy: the day's hands come from an HMAC of the date under a secret
// (POKER_DAILY_SECRET, or one generated once and kept on the data volume), so
// nobody can deal them out ahead of time. A hand is sent only when the player
// reaches it, its answer only once it is answered, and the grading is done
// here from the player's choice alone.
//
// Attempts: one official run per account per day, recorded the moment it
// starts. Closing the tab keeps it (the clock keeps running on the open hand);
// leaving it locks in the answers so far and scores the rest 0, and so does
// the day ending first. After that, practice runs deal fresh random hands and
// are never recorded.
//
// Time: only thinking time counts, from a hand being sent to its answer, so
// reading an answer costs nothing.

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { debouncedWriter, readJson, writeJson } from '../jsonstore.ts';
import { addDays, dailyDate, dailyNumber, dayIndex, dayStreak, nextDailyAt } from '../../../shared/daily.ts';
import {
  POKER_DAILY_HANDS, POKER_DAILY_TOP, comparePokerDaily,
  type PokerDailyDay, type PokerDailyInfo, type PokerDailyProfile, type PokerDailyResult, type PokerDailyRow,
  type PokerDailyStreaks, type PokerReveal, type PokerRunView,
} from '../../../shared/poker/daily.ts';
import { daySpotAsync, type DealtSpot } from './spots.ts';

export interface PokerAnswer {
  /** The option picked; null for a hand that was open when the run was left. */
  choice: string | null;
  points: number;
  ms: number;
}

/** One account's official run on one day. */
export interface PokerDailyRun {
  date: string;
  id: string;
  name: string;
  avatar?: string;
  startedAt: number;
  /** Null while it is under way. */
  endedAt: number | null;
  answers: PokerAnswer[];
  /** When the hand to answer now was sent (null: none sent yet). */
  servedAt: number | null;
  left?: boolean;
}

interface DailyFile {
  salt: string;
  runs: PokerDailyRun[];
}

export interface Player {
  id: string;
  name: string;
  avatar?: string;
}

export class PokerDailyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const FILE = 'poker-daily.json';
/** Runs kept: about two years of a busy site. */
const MAX_RUNS = 200_000;
/** Days the history endpoint goes back, at most. */
export const POKER_HISTORY_MAX = 60;
/** A hand's thinking time counts up to this (a tab left open overnight is not a 9-hour think). */
const MAX_HAND_MS = 30 * 60_000;
/** Practice runs held in memory at once (one per player), and how long one lives. */
const MAX_PRACTICE = 5_000;
const PRACTICE_TTL = 3 * 3_600_000;

let salt = '';
let runs: PokerDailyRun[] = [];
/** date → account id → run. */
const byDay = new Map<string, Map<string, PokerDailyRun>>();
const save = debouncedWriter(FILE, (): DailyFile => ({ salt, runs }), 500);
let dirty = false;
const markDirty = () => { dirty = true; save(); };
process.once('exit', () => {
  if (!dirty) return;
  try { writeJson(FILE, { salt, runs }); } catch (e) { console.error(`Could not save ${FILE}:`, e); }
});

function index(r: PokerDailyRun) {
  let day = byDay.get(r.date);
  if (!day) byDay.set(r.date, day = new Map());
  day.set(r.id, r);
}

export function loadPokerDaily(): void {
  const f = readJson<Partial<DailyFile>>(FILE, {});
  runs = Array.isArray(f?.runs) ? f.runs.filter(r => r && typeof r.id === 'string' && typeof r.date === 'string' && Array.isArray(r.answers)) : [];
  byDay.clear();
  for (const r of runs) index(r);
  salt = typeof f?.salt === 'string' && f.salt.length >= 16 ? f.salt : '';
  if (!salt) {
    salt = randomBytes(24).toString('hex');
    markDirty();
  }
}

/** The day's seed: secret, the same all day, different every day. */
export function pokerDailySeed(date: string): string {
  const key = process.env.POKER_DAILY_SECRET || salt;
  return createHmac('sha256', key).update(`poker-daily:${date}`).digest('hex');
}

// ---- dealing, cached ----

/** seed → hand index → the dealt hand (a promise while it is being dealt). */
const dealt = new Map<string, Map<number, Promise<DealtSpot>>>();
/** Seeds kept dealt: a few days' worth plus the practice runs in play. */
const MAX_SEEDS = 64;

function spotOf(seed: string, i: number): Promise<DealtSpot> {
  let m = dealt.get(seed);
  if (!m) {
    dealt.set(seed, m = new Map());
    while (dealt.size > MAX_SEEDS) dealt.delete(dealt.keys().next().value!);
  }
  let p = m.get(i);
  if (!p) {
    p = daySpotAsync(seed, i);
    m.set(i, p);
    p.catch(() => m!.delete(i));
  }
  return p;
}

/** A day's hand. */
export function pokerDailySpot(date: string, i: number): Promise<DealtSpot> {
  return spotOf(pokerDailySeed(date), i);
}

const warming = new Set<string>();
/** Deal the day's hands in the background, one after another, so the first player never waits. */
export function warmPokerDaily(date: string): void {
  if (warming.has(date)) return;
  warming.add(date);
  void (async () => {
    for (let i = 0; i < POKER_DAILY_HANDS; i++) await pokerDailySpot(date, i).catch(() => {});
  })();
}

// ---- runs ----

export function pokerDailyRun(date: string, id: string): PokerDailyRun | undefined {
  return byDay.get(date)?.get(id);
}

/** A run's result so far: the hands not answered score 0 (shown as -1 in the grid). */
export function runResult(r: PokerDailyRun): PokerDailyResult {
  const grid = Array.from({ length: POKER_DAILY_HANDS }, (_, i) => r.answers[i]?.choice != null ? r.answers[i].points : -1);
  return {
    points: r.answers.reduce((s, a) => s + a.points, 0),
    timeMs: r.answers.reduce((s, a) => s + a.ms, 0),
    grid,
    ...(r.left && { left: true }),
  };
}

/** Lock a run in where it stands: the rest score 0. */
function leaveRun(r: PokerDailyRun, now: number) {
  if (r.endedAt !== null) return;
  if (r.servedAt !== null && r.answers.length < POKER_DAILY_HANDS) {
    r.answers.push({ choice: null, points: 0, ms: Math.min(MAX_HAND_MS, Math.max(0, now - r.servedAt)) });
  }
  r.servedAt = null;
  r.left = r.answers.filter(a => a.choice !== null).length < POKER_DAILY_HANDS;
  r.endedAt = now;
  markDirty();
}

/** Runs still open from a day that is over: left, as at that day's end. */
export function reconcilePokerDaily(now = Date.now()): void {
  const today = dailyDate(now);
  for (const r of runs) {
    if (r.endedAt === null && r.date < today) leaveRun(r, Math.min(now, (dayIndex(r.date) + 1) * 86_400_000));
  }
}

function dayRows(date: string): PokerDailyRow[] {
  const rows = [...(byDay.get(date)?.values() ?? [])]
    .filter(r => r.endedAt !== null)
    .map((r): PokerDailyRow => ({ id: r.id, name: r.name, ...(r.avatar && { avatar: r.avatar }), endedAt: r.endedAt!, rank: 0, ...runResult(r) }))
    .sort(comparePokerDaily);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function streaksOf(id: string, today: string): PokerDailyStreaks {
  const s = dayStreak(runs.filter(r => r.id === id).map(r => r.date), today);
  return { streak: s.current, best: s.best };
}

// ---- practice ----

interface Practice {
  id: string;
  userId: string;
  seed: string;
  answers: PokerAnswer[];
  servedAt: number | null;
  createdAt: number;
}
/** userId → their practice run. */
const practices = new Map<string, Practice>();

function newPractice(userId: string, now: number): Practice {
  for (const [k, p] of practices) if (now - p.createdAt > PRACTICE_TTL) practices.delete(k);
  while (practices.size >= MAX_PRACTICE) practices.delete(practices.keys().next().value!);
  const p: Practice = { id: randomUUID(), userId, seed: `practice:${randomBytes(16).toString('hex')}`, answers: [], servedAt: null, createdAt: now };
  practices.set(userId, p);
  return p;
}

// ---- views ----

function reveal(d: DealtSpot, a: PokerAnswer, i: number): PokerReveal {
  return {
    index: i, spot: d.spot, choice: a.choice, points: a.points, ms: a.ms,
    best: d.answer.best, options: d.answer.options, equity: d.answer.equity, needed: d.answer.needed,
    range: d.answer.range, combos: d.answer.combos,
  };
}

async function view(o: { mode: 'official' | 'practice'; run: string; seed: string; date: string; answers: PokerAnswer[]; open: boolean }): Promise<PokerRunView> {
  const reveals = await Promise.all(o.answers.map(async (a, i) => reveal(await spotOf(o.seed, i), a, i)));
  const next = o.open && o.answers.length < POKER_DAILY_HANDS ? (await spotOf(o.seed, o.answers.length)).spot : null;
  return { mode: o.mode, run: o.run, date: o.date, number: dailyNumber(o.date), total: POKER_DAILY_HANDS, spot: next, reveals };
}

async function officialView(r: PokerDailyRun): Promise<PokerRunView> {
  const v = await view({ mode: 'official', run: 'official', seed: pokerDailySeed(r.date), date: r.date, answers: r.answers, open: r.endedAt === null && r.servedAt !== null });
  if (r.endedAt !== null) {
    const rows = dayRows(r.date);
    v.result = runResult(r);
    v.rank = rows.find(x => x.id === r.id)?.rank;
    v.of = rows.length;
    v.streak = streaksOf(r.id, r.date).streak;
  }
  return v;
}

/**
 * "Play": the official run the first time today, the same run (and the same
 * open hand) while it is under way; once it is over, the finished run, or
 * with `practice` a practice run (a fresh one with `fresh`, or once the last
 * is done). Sends the next hand when none is open.
 */
export async function playPokerDaily(p: Player, opts: { practice?: boolean; fresh?: boolean; now?: number } = {}): Promise<PokerRunView> {
  const now = opts.now ?? Date.now();
  const date = dailyDate(now);
  reconcilePokerDaily(now);
  let r = pokerDailyRun(date, p.id);
  if (!r) {
    r = { date, id: p.id, name: p.name, ...(p.avatar && { avatar: p.avatar }), startedAt: now, endedAt: null, answers: [], servedAt: null };
    runs.push(r);
    index(r);
    if (runs.length > MAX_RUNS) {
      const gone = runs.splice(0, runs.length - MAX_RUNS);
      for (const g of gone) byDay.get(g.date)?.delete(g.id);
    }
    markDirty();
  }
  if (r.endedAt === null) {
    // Deal the hand before the clock starts on it.
    if (r.servedAt === null) {
      const t0 = Date.now();
      await pokerDailySpot(date, r.answers.length);
      if (r.endedAt === null && r.servedAt === null) { r.servedAt = now + (Date.now() - t0); markDirty(); }
    }
    return officialView(r);
  }
  if (!opts.practice) return officialView(r);
  let pr = practices.get(p.id);
  if (!pr || opts.fresh || pr.answers.length >= POKER_DAILY_HANDS || now - pr.createdAt > PRACTICE_TTL) pr = newPractice(p.id, now);
  if (pr.servedAt === null && pr.answers.length < POKER_DAILY_HANDS) {
    const t0 = Date.now();
    await spotOf(pr.seed, pr.answers.length);
    if (pr.servedAt === null) pr.servedAt = now + (Date.now() - t0);
  }
  return view({ mode: 'practice', run: pr.id, seed: pr.seed, date, answers: pr.answers, open: pr.servedAt !== null });
}

/** Answer the open hand: graded here, from the choice alone. */
export async function answerPokerDaily(
  p: Player, a: { run: string; index: number; choice: string }, opts: { now?: number } = {},
): Promise<{ reveal: PokerReveal; view: PokerRunView }> {
  const now = opts.now ?? Date.now();
  const date = dailyDate(now);
  if (a.run === 'official') {
    reconcilePokerDaily(now);
    const r = pokerDailyRun(date, p.id);
    if (!r || r.endedAt !== null) throw new PokerDailyError('Your run for today is over');
    if (r.servedAt === null || a.index !== r.answers.length) throw new PokerDailyError('That hand is not the one in front of you', 409);
    const d = await pokerDailySpot(date, a.index);
    // Checked again: another answer may have landed while the hand was fetched.
    if (r.endedAt !== null || r.servedAt === null || a.index !== r.answers.length) throw new PokerDailyError('That hand is not the one in front of you', 409);
    const opt = d.answer.options.find(o => o.id === a.choice);
    if (!opt) throw new PokerDailyError('Pick one of the moves on offer');
    const ans: PokerAnswer = { choice: opt.id, points: opt.points, ms: Math.min(MAX_HAND_MS, Math.max(0, now - r.servedAt)) };
    r.answers.push(ans);
    r.servedAt = null;
    if (r.answers.length >= POKER_DAILY_HANDS) r.endedAt = now;
    markDirty();
    return { reveal: reveal(d, ans, a.index), view: await officialView(r) };
  }
  const pr = practices.get(p.id);
  if (!pr || pr.id !== a.run) throw new PokerDailyError('That practice run is over — start another', 404);
  if (pr.servedAt === null || a.index !== pr.answers.length) throw new PokerDailyError('That hand is not the one in front of you', 409);
  const d = await spotOf(pr.seed, a.index);
  if (pr.servedAt === null || a.index !== pr.answers.length) throw new PokerDailyError('That hand is not the one in front of you', 409);
  const opt = d.answer.options.find(o => o.id === a.choice);
  if (!opt) throw new PokerDailyError('Pick one of the moves on offer');
  const ans: PokerAnswer = { choice: opt.id, points: opt.points, ms: Math.min(MAX_HAND_MS, Math.max(0, now - pr.servedAt)) };
  pr.answers.push(ans);
  pr.servedAt = null;
  return {
    reveal: reveal(d, ans, a.index),
    view: await view({ mode: 'practice', run: pr.id, seed: pr.seed, date, answers: pr.answers, open: false }),
  };
}

/** Leave: an official run locks in where it stands; a practice run is dropped. */
export function leavePokerDaily(p: Player, run: string, now = Date.now()): { left: boolean } {
  if (run === 'official') {
    const r = pokerDailyRun(dailyDate(now), p.id);
    if (!r || r.endedAt !== null) return { left: false };
    leaveRun(r, now);
    return { left: true };
  }
  const pr = practices.get(p.id);
  if (pr?.id === run) practices.delete(p.id);
  return { left: !!pr };
}

/** GET /api/poker/daily: one day's leaderboard and (signed in) where you stand. */
export function pokerDailyInfo(date: string, opts: { userId?: string; now?: number; leaders?: boolean } = {}): PokerDailyInfo {
  const now = opts.now ?? Date.now();
  const today = dailyDate(now);
  const rows = dayRows(date);
  const info: PokerDailyInfo = {
    date, number: dailyNumber(date), today,
    endsAt: date === today ? nextDailyAt(now) : (dayIndex(date) + 1) * 86_400_000,
    hands: POKER_DAILY_HANDS,
    players: rows.length,
    leaders: opts.leaders === false ? [] : rows.slice(0, POKER_DAILY_TOP),
  };
  if (opts.userId) {
    const r = pokerDailyRun(date, opts.userId);
    const mine = rows.find(x => x.id === opts.userId);
    info.you = {
      status: !r ? 'none' : r.endedAt === null ? 'playing' : 'done',
      answered: r ? r.answers.filter(a => a.choice !== null).length : 0,
      ...(r?.endedAt != null && { result: runResult(r) }),
      ...(mine && { rank: mine.rank }),
      streaks: streaksOf(opts.userId, today),
    };
  }
  return info;
}

/** GET /api/poker/daily/history: the days before today, newest first. */
export function pokerDailyHistory(opts: { days?: number; userId?: string; now?: number } = {}): PokerDailyDay[] {
  const today = dailyDate(opts.now ?? Date.now());
  const n = Math.min(POKER_HISTORY_MAX, Math.max(1, Math.floor(opts.days ?? 14)));
  const out: PokerDailyDay[] = [];
  for (let k = 1; k <= n; k++) {
    const date = addDays(today, -k);
    if (dailyNumber(date) < 1) break;
    const rows = dayRows(date);
    out.push({
      date, number: dailyNumber(date), players: rows.length, top: rows[0] ?? null,
      ...(opts.userId && { you: rows.find(r => r.id === opts.userId) ?? null }),
    });
  }
  return out;
}

/** The Poker Daily on a profile: streaks, average and the best run. Null before a first run. */
export function pokerDailyProfile(id: string, now = Date.now()): PokerDailyProfile | null {
  const mine = runs.filter(r => r.id === id);
  if (!mine.length) return null;
  const done = mine.filter(r => r.endedAt !== null);
  let best: PokerDailyProfile['best'] = null;
  for (const r of done) {
    const rows = dayRows(r.date);
    const row = rows.find(x => x.id === id)!;
    if (!best || comparePokerDaily(row, best) < 0) best = { ...row, date: r.date, number: dailyNumber(r.date), of: rows.length };
  }
  return {
    played: mine.length,
    average: done.length ? Math.round(done.reduce((s, r) => s + runResult(r).points, 0) / done.length) : 0,
    streaks: streaksOf(id, dailyDate(now)),
    best,
  };
}

/** A deleted player (../erase.ts): their runs go. */
export function erasePokerDaily(id: string): number {
  const before = runs.length;
  runs = runs.filter(r => r.id !== id);
  for (const day of byDay.values()) day.delete(id);
  practices.delete(id);
  const n = before - runs.length;
  if (n) markDirty();
  return n;
}

/** For tests: forget everything (the salt and the dealt hands included). */
export function resetPokerDaily(): void {
  runs = [];
  byDay.clear();
  practices.clear();
  dealt.clear();
  warming.clear();
  salt = randomBytes(24).toString('hex');
  dirty = false;
}
