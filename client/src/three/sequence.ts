// Pacing between the 3D scene and the HUD. Every roll plays as three beats:
// the dice tumble and settle, the result pops up big in the middle of the
// screen and flies down into the action bar, and only then does the piece
// walk; after that the action buttons and cards appear. The server has already
// moved on by the time any of this plays; this just stages what the player
// sees. The timings live in shared/pacing.ts, which the server's bots read too.
//
// A move (GameView.lastMove) is planned once, on the clock, the moment a view
// carrying it is first seen (stageView): when each leg starts walking, when
// each card drawn on the way is turned over, and when it is all over. Pieces,
// cards, money and notices all read that plan, so a slow device (a frame
// every half second) skips ahead rather than falls behind, and the HUD is
// held once, for the planned length.

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  CARD_FLIGHT_MS, CARD_MS, DICE_MS, HOP_MS, MAX_HOPS, RESULT_HOLD_MS, RESULT_IN_MS, RESULT_MS, SETTLE_MS, WALK_DELAY_MS, legWalkMs,
} from '../../../shared/pacing.ts';
import type { CardShown, GameView, MoveLeg } from '../../../shared/types.ts';

/** CARD_FLIGHT_MS: how long a drawn card takes to fly from its pile to the camera (CardDecks). */
export { CARD_FLIGHT_MS, CARD_MS, DICE_MS, RESULT_MS };
/** Never hold the HUD longer than this, whatever the scene reports... */
const MAX_HOLD_MS = 7000;
/** ...except for a planned move (dice, legs and cards), which is held to its planned end. */
const PLAN_HOLD_MS = 30_000;

let rollSeq = -1;
/** markRoll has run at least once. */
let rollMarked = false;
let rollAt = 0;
let busyUntil = 0;
let busy = false;
/** Where the latest roll's beats have got to (see useRollStage). */
export type RollBeat = 'tumble' | 'result' | 'fly' | 'done';
export interface RollStage { seq: number; beat: RollBeat }
let stage: RollStage = { seq: -1, beat: 'done' };
const stageListeners = new Set<() => void>();
let stageTimers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<(b: boolean) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function setBusy(b: boolean) {
  if (b === busy) return;
  busy = b;
  for (const l of listeners) l(b);
}

function schedule() {
  if (timer) clearTimeout(timer);
  const wait = busyUntil - performance.now();
  if (wait <= 0) { setBusy(false); timer = null; return; }
  timer = setTimeout(schedule, wait + 10);
}

/** ?perf: what is holding the scene (window.__yotSeq). */
export function sequenceDebug() {
  return { busy, holdMs: Math.round(busyUntil - performance.now()), stage: stage.beat, rollSeq, moves: movesDebug() };
}

/** When the scene as it stands now will be still (performance.now() time; now if it already is). */
export function sceneFreeAt(): number {
  return busy ? busyUntil : performance.now();
}

/** The scene is animating until `until` (performance.now() time), at most `cap` from now. */
export function holdUntil(until: number, cap = MAX_HOLD_MS) {
  const now = performance.now();
  const capped = Math.min(until, now + cap);
  if (capped <= busyUntil + 30 && busy) return;
  busyUntil = Math.max(busyUntil, capped);
  if (busyUntil > now) { setBusy(true); schedule(); }
}

/**
 * Called by the dice when a new roll arrives (during render, before any frame
 * runs, so pieces in the same frame already see it). `initial`: the dice just
 * mounted, so this is the current state (a reload, the lobby), not a new throw.
 */
export function markRoll(seq: number, initial: boolean) {
  if (seq === rollSeq) return;
  rollSeq = seq;
  rollMarked = true;
  for (const t of stageTimers) clearTimeout(t);
  stageTimers = [];
  if (initial) {
    setStage({ seq, beat: 'done' });
    return;
  }
  rollAt = performance.now();
  holdUntil(rollAt + WALK_DELAY_MS);
  setStage({ seq, beat: 'tumble' });
  const at = (ms: number, beat: RollBeat) => stageTimers.push(setTimeout(() => setStage({ seq, beat }), ms));
  at(DICE_MS, 'result');
  at(DICE_MS + RESULT_IN_MS + RESULT_HOLD_MS, 'fly');
  at(WALK_DELAY_MS, 'done');
}

function setStage(next: RollStage) {
  stage = next;
  // markRoll runs during a render: tell subscribers afterwards, never mid-render.
  queueMicrotask(() => { for (const l of stageListeners) l(); });
}

/**
 * When the latest throw has played its dice and its result; pieces wait until
 * then to walk.
 */
export function diceSettleAt(): number {
  return rollAt ? rollAt + WALK_DELAY_MS : 0;
}

/**
 * The beat roll `seq` has reached: 'tumble' (dice in the air), 'result' (the
 * big score is up), 'fly' (it is flying to the action bar), 'done'. A roll the
 * scene has not picked up yet counts as tumbling, so the HUD never shows a
 * score before the dice do; call it with the game's rollSeq.
 */
export function useRollStage(seq: number): RollBeat {
  const s = useSyncExternalStore(subscribeStage, () => stage);
  if (s.seq === seq) return s.beat;
  // Before the board's dice have reported anything (first paint) the roll on
  // the table is history; afterwards an unseen seq is a throw on its way in.
  return s.seq === -1 ? 'done' : 'tumble';
}

function subscribeStage(l: () => void) {
  stageListeners.add(l);
  return () => { stageListeners.delete(l); };
}

/** True while the dice roll or a piece walks: hold buttons and cards until it's over. */
export function useSceneBusy(): boolean {
  const [b, setB] = useState(busy);
  useEffect(() => {
    listeners.add(setB);
    setB(busy);
    return () => { listeners.delete(setB); };
  }, []);
  return b;
}

/**
 * The game log as the board has shown it so far. The server logs a roll, the
 * landing and any rent all at once, before the dice have even tumbled; lines
 * that arrive are held back until the move they came with (LogEntry.move) has
 * played to its planned end, and other lines until whatever move is playing
 * is over, so notices never announce a move the piece hasn't made yet. Lines
 * already there when the view mounts show at once.
 */
export function useStagedLog<T extends { t: number; move?: number }>(log: T[]): T[] {
  const [shownT, setShownT] = useState(() => log.at(-1)?.t ?? 0);
  const newest = log.at(-1)?.t ?? 0;
  useEffect(() => {
    if (newest <= shownT) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const fresh = log.filter(l => l.t > shownT);
    const release = () => {
      const now = performance.now();
      let at = now;
      // In order: a line never shows before the one above it.
      for (const l of fresh) {
        at = Math.max(at, (l.move !== undefined ? planEnd(l.move) : undefined) ?? movesFreeAt());
        const t = l.t;
        timers.push(setTimeout(() => setShownT(v => Math.max(v, t)), at - now));
      }
    };
    // A move the board has not staged yet (it renders a moment after the HUD): give it a frame.
    const raf = fresh.some(l => l.move !== undefined && planEnd(l.move) === undefined) ? requestAnimationFrame(release) : 0;
    if (!raf) release();
    // A hidden tab never paints: show the lines rather than hold them forever.
    const fallback = setTimeout(() => setShownT(v => Math.max(v, newest)), 20_000);
    return () => { cancelAnimationFrame(raf); for (const t of timers) clearTimeout(t); clearTimeout(fallback); };
  }, [log, newest, shownT]);
  return newest <= shownT ? log : log.filter(l => l.t <= shownT);
}

// ---- moves -------------------------------------------------------------------

/** One leg of a staged move, on the performance.now() clock. */
export interface PlannedLeg extends MoveLeg {
  /** When the first hop (or the flight) starts. */
  t0: number;
  /** How long the walk or flight takes (shared/pacing.ts legWalkMs). */
  walkMs: number;
  /** When the card drawn at the end of this leg starts flying up (if one was). */
  cardAt?: number;
}

/** A move as the scene plays it. */
export interface MovePlan {
  seq: number;
  player: string;
  legs: PlannedLeg[];
  /** When the first leg starts (after the dice and the result, and after any move still walking). */
  start: number;
  /** When the whole move is over and the landing settled: buttons, money and notices come back then. */
  end: number;
  /** Already over when this page first saw it (a reload, joining mid-game): nothing to play. */
  initial: boolean;
}

let stagedGame: number | null = null;
const plans = new Map<number, MovePlan>();
/** Moves never overlap: the next one starts walking once this one has finished (cards included). */
let walkFreeAt = 0;
/** The latest planned end of anything staged (moves and stray walks). */
let freeAt = 0;
/** The highest card seq handed to the scene (or already showing when we arrived). */
let cardSeen = 0;

/**
 * Stage what a game view brings: plan its move (once per move, however many
 * components ask) and cue a card drawn outside one. Call it during render
 * with every new view; it returns the latest move's plan.
 */
export function stageView(game: Pick<GameView, 'lastMove' | 'lastCard' | 'startedAt'>): MovePlan | null {
  const first = stagedGame !== game.startedAt;
  if (first) {
    stagedGame = game.startedAt;
    plans.clear();
    walkFreeAt = freeAt = 0;
    cardSeen = game.lastCard?.seq ?? 0;
  }
  const m = game.lastMove;
  if (m && !plans.has(m.seq)) {
    plans.set(m.seq, planMove(m, first));
    // Old moves are of no more use.
    if (plans.size > 24) plans.delete(Math.min(...plans.keys()));
  }
  const c = game.lastCard;
  if (c && c.seq > cardSeen) {
    // Not drawn on a move we know of (an older server): turn it over once the scene is still.
    cardSeen = c.seq;
    cueCard(c, movesFreeAt());
  }
  return m ? plans.get(m.seq) ?? null : null;
}

function planMove(m: NonNullable<GameView['lastMove']>, initial: boolean): MovePlan {
  const now = performance.now();
  if (initial) {
    for (const l of m.legs) if (l.card) cardSeen = Math.max(cardSeen, l.card.seq);
    return { seq: m.seq, player: m.player, legs: m.legs.map(l => ({ ...l, t0: now, walkMs: 0 })), start: now, end: now, initial: true };
  }
  let start = now;
  if (m.roll !== undefined) {
    // The throw this move came with: walk once its dice and result have played.
    // (The dice mark a throw during the same render; if they have not yet, they are about to.)
    if (m.roll === rollSeq && rollMarked) start = rollAt + WALK_DELAY_MS;
    else if (m.roll > rollSeq) start = now + WALK_DELAY_MS;
  }
  start = Math.max(start, walkFreeAt);
  let t = start;
  const legs: PlannedLeg[] = m.legs.map(l => {
    const leg: PlannedLeg = { ...l, t0: t, walkMs: legWalkMs(l) };
    t += leg.walkMs;
    if (l.card) {
      leg.cardAt = t;
      cardSeen = Math.max(cardSeen, l.card.seq);
      cueCard(l.card, t);
      t += CARD_MS;
    }
    return leg;
  });
  const end = legs.length > 0 || m.roll !== undefined ? t + SETTLE_MS : now;
  walkFreeAt = Math.max(walkFreeAt, t);
  freeAt = Math.max(freeAt, end);
  // Hold the HUD once, for the whole plan.
  if (end > now) holdUntil(end, PLAN_HOLD_MS);
  return { seq: m.seq, player: m.player, legs, start, end, initial: false };
}

/** When move `seq` is over (undefined: not staged). */
export function planEnd(seq: number): number | undefined {
  return plans.get(seq)?.end;
}

/** Move `seq` as staged (undefined: not staged). */
export function planOf(seq: number): MovePlan | undefined {
  return plans.get(seq);
}

/**
 * When every move staged before move `seq` has played out: the moment move
 * `seq` takes over the board (performance.now() time; now if they have).
 */
export function freeBefore(seq: number): number {
  let t = performance.now();
  for (const p of plans.values()) if (p.seq < seq) t = Math.max(t, p.end);
  return t;
}

/**
 * When the piece on move `seq` lands on or passes GO, once per leg that does,
 * in order (performance.now() times): the hop onto GO for a walk, the landing
 * for a flight. Legs that fly with no step count (teleports) are left out.
 * Empty when the move is not staged or was already over when it arrived.
 */
export function goPassTimes(seq: number, n: number): number[] {
  const p = plans.get(seq);
  if (!p || p.initial) return [];
  const out: number[] = [];
  for (const l of p.legs) {
    if (l.kind === 'jail' || l.kind === 'teleport' || !l.steps || l.steps <= 0) continue;
    const origin = ((l.to - l.steps) % n + n) % n;
    if (origin + l.steps < n) continue;
    // Pieces.tsx addLeg: one hop per space, the first one twice as long when it is a leap out of the cell.
    out.push(l.steps <= MAX_HOPS ? l.t0 + (n - origin) * HOP_MS + (l.leap ? HOP_MS : 0) : l.t0 + l.walkMs);
  }
  return out;
}

/** Player `id`'s staged moves after `afterSeq`, oldest first. */
export function plansFor(id: string, afterSeq: number): MovePlan[] {
  return [...plans.values()].filter(p => p.player === id && p.seq > afterSeq).sort((a, b) => a.seq - b.seq);
}

/** The game the staged moves belong to (GameView.startedAt). */
export function stagedGameKey(): number | null {
  return stagedGame;
}

/** When every move staged so far has played out (performance.now() time; now if they have). */
export function movesFreeAt(): number {
  return Math.max(performance.now(), freeAt);
}

/**
 * A walk the board works out for itself (a position change no move record
 * explains): it waits for any move still walking and holds the HUD for its
 * length. Returns when it starts.
 */
export function reserveWalk(earliest: number, ms: number): number {
  const start = Math.max(earliest, performance.now(), walkFreeAt);
  walkFreeAt = start + ms;
  freeAt = Math.max(freeAt, walkFreeAt + SETTLE_MS);
  holdUntil(walkFreeAt + SETTLE_MS, PLAN_HOLD_MS);
  return start;
}

// ---- cards -------------------------------------------------------------------

/** A card the scene turns over: it lifts off its pile at `at` (performance.now() time). */
export interface CardCue { card: CardShown; at: number }
let cue: CardCue | null = null;
const cueListeners = new Set<() => void>();

function cueCard(card: CardShown, at: number) {
  setTimeout(() => {
    cue = { card, at };
    for (const l of cueListeners) l();
  }, Math.max(0, at - performance.now()));
}

/**
 * The latest card cue, published at its planned time: CardDecks flies it up
 * from its pile, CardPopup shows its text as it arrives (at + CARD_FLIGHT_MS).
 */
export function useCardCue(): CardCue | null {
  return useSyncExternalStore(subscribeCue, () => cue);
}

function subscribeCue(l: () => void) {
  cueListeners.add(l);
  return () => { cueListeners.delete(l); };
}

/** ?perf: the staged moves (also in window.__yotSeq). */
function movesDebug() {
  const now = performance.now();
  return {
    walkFreeInMs: Math.round(walkFreeAt - now), freeInMs: Math.round(freeAt - now), cardSeen,
    plans: [...plans.values()].slice(-4).map(p => ({
      seq: p.seq, player: p.player.slice(-6), initial: p.initial, startInMs: Math.round(p.start - now), endInMs: Math.round(p.end - now),
      legs: p.legs.map(l => ({ to: l.to, kind: l.kind, steps: l.steps, t0InMs: Math.round(l.t0 - now), card: l.card?.seq })),
    })),
  };
}
