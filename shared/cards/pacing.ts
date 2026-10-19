// How long clients take to stage each step of a play (CardsPlay.steps): a card
// flying to the discard, a draw fanning into a hand, a skip flash. The client's
// cards/sequence.ts schedules exactly these; the server's room waits for the
// same sum before a bot moves and before a turn clock starts, so nobody acts
// (or loses thinking time) while the table is still animating.

import type { CardsStep } from './types.ts';

export const CARDS_PLAY_MS = 520;
export const CARDS_FLIP_MS = 650;
/** One card of a draw; a bigger draw overlaps them (see stepMs). */
export const CARDS_DRAW_MS = 380;
export const CARDS_DRAW_GAP_MS = 110;
export const CARDS_DEAL_GAP_MS = 28;
export const CARDS_SETTLE_MS = 120;
/** Never let one play hold the table longer than this. */
export const CARDS_MAX_PLAY_MS = 4_500;
/** Queued plays never push the scene further ahead than this. */
export const CARDS_MAX_QUEUE_MS = 6_000;

/** How long one step takes to stage. */
export function cardsStepMs(s: CardsStep): number {
  switch (s.type) {
    case 'deal': return Math.min(2_400, 500 + s.order.length * s.count * CARDS_DEAL_GAP_MS);
    case 'flip': return CARDS_FLIP_MS;
    case 'play': return CARDS_PLAY_MS;
    case 'draw': return CARDS_DRAW_MS + Math.min(s.count - 1, 8) * CARDS_DRAW_GAP_MS;
    case 'reshuffle': return 800;
    case 'skip': return 650;
    case 'reverse': return 700;
    case 'color': return 550;
    case 'swap': return 900;
    case 'rotate': return 1_000;
    case 'challenge': return 1_500;
    case 'call': return 300;
    case 'catch': return 650;
    case 'pass': return 200;
    case 'timeout': return 300;
    case 'leave': return 300;
    case 'roundEnd': return 1_400;
  }
}

/**
 * Each step's start (from the play's start) and length, back to back. A play
 * that would run past CARDS_MAX_PLAY_MS is played faster, every step alike.
 */
export function cardsStepTimes(steps: readonly CardsStep[]): { at: number; dur: number }[] {
  const raw = steps.map(cardsStepMs);
  const total = raw.reduce((a, b) => a + b, 0);
  const k = total + CARDS_SETTLE_MS > CARDS_MAX_PLAY_MS ? (CARDS_MAX_PLAY_MS - CARDS_SETTLE_MS) / total : 1;
  let at = 0;
  return raw.map(ms => {
    const dur = Math.round(ms * k);
    const t = { at, dur };
    at += dur;
    return t;
  });
}

/** A whole play, steps back to back, plus a short settle (0 for nothing to show). */
export function cardsPlayMs(steps: readonly CardsStep[]): number {
  if (!steps.length) return 0;
  const t = cardsStepTimes(steps);
  const last = t[t.length - 1];
  return last.at + last.dur + CARDS_SETTLE_MS;
}
