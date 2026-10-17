// Pacing between the 3D scene and the HUD: the dice tumble first, then the
// piece walks, and only then do the action buttons and cards appear. The
// server has already moved on by the time any of this plays; this just stages
// what the player sees, so a roll reads as roll → move → result.

import { useEffect, useState } from 'react';

/** How long the dice tumble before they settle (Dice.tsx). */
export const DICE_MS = 1100;
/** How long a drawn card takes to fly from its pile to the camera (CardDecks). */
export const CARD_FLIGHT_MS = 800;
/** Never hold the HUD longer than this, whatever the scene reports. */
const MAX_HOLD_MS = 7000;

let rollSeq = -1;
let rollAt = 0;
let busyUntil = 0;
let busy = false;
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
  if (initial) return;
  rollAt = performance.now();
  holdUntil(rollAt + DICE_MS);
}

/** When the dice of the latest throw settle; pieces wait until then to walk. */
export function diceSettleAt(): number {
  return rollAt ? rollAt + DICE_MS : 0;
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
