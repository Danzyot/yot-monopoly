// Pacing between the 3D scene and the HUD. Every roll plays as three beats:
// the dice tumble and settle, the result pops up big in the middle of the
// screen and flies down into the action bar, and only then does the piece
// walk; after that the action buttons and cards appear. The server has already
// moved on by the time any of this plays; this just stages what the player
// sees. The timings live in shared/pacing.ts, which the server's bots read too.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { CARD_FLIGHT_MS, DICE_MS, RESULT_HOLD_MS, RESULT_IN_MS, RESULT_MS, WALK_DELAY_MS } from '../../../shared/pacing.ts';

/** CARD_FLIGHT_MS: how long a drawn card takes to fly from its pile to the camera (CardDecks). */
export { CARD_FLIGHT_MS, DICE_MS, RESULT_MS };
/** Never hold the HUD longer than this, whatever the scene reports. */
const MAX_HOLD_MS = 7000;

let rollSeq = -1;
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
  timer = setTimeout(schedule, Math.min(wait + 10, MAX_HOLD_MS));
}

/** ?perf: what is holding the scene (window.__yotSeq). */
export function sequenceDebug() {
  return { busy, holdMs: Math.round(busyUntil - performance.now()), stage: stage.beat, rollSeq };
}

/** When the scene as it stands now will be still (performance.now() time; now if it already is). */
export function sceneFreeAt(): number {
  return busy ? busyUntil : performance.now();
}

/** The scene is animating until `until` (performance.now() time). */
export function holdUntil(until: number) {
  const now = performance.now();
  const capped = Math.min(until, now + MAX_HOLD_MS);
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
 * that arrive are held back until the scene they came with (dice, result,
 * walk, card) has played, so notices never announce a move the piece hasn't
 * made yet. Lines already there when the view mounts show at once.
 */
export function useStagedLog<T extends { t: number }>(log: T[]): T[] {
  const [shownT, setShownT] = useState(() => log.at(-1)?.t ?? 0);
  const newest = log.at(-1)?.t ?? 0;
  useEffect(() => {
    if (newest <= shownT) return;
    // Two frames: the dice mark the roll during render and the pieces report
    // their walk on the next frame, so by then sceneFreeAt() covers this move.
    let r2 = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        t = setTimeout(() => setShownT(v => Math.max(v, newest)), Math.max(0, sceneFreeAt() - performance.now()));
      });
    });
    // A hidden tab never paints: show the lines rather than hold them forever.
    const fallback = setTimeout(() => setShownT(v => Math.max(v, newest)), 12_000);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); if (t) clearTimeout(t); clearTimeout(fallback); };
  }, [newest, shownT]);
  return newest <= shownT ? log : log.filter(l => l.t <= shownT);
}

