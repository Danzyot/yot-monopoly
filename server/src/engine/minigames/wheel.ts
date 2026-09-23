// Wheel Spin: solo. The lander presses Spin (or the clock does it for them);
// the server picks a weighted segment and the clients animate the wheel to it.
// The segment is chosen at spin time, so there is nothing to peek at before.

import { WHEEL_SEGMENTS } from '../../../../shared/minigames.ts';
import { jitter, reject, type MinigameDef, type Rng } from './types.ts';

export const WHEEL_MS = 8_000;

export interface WheelState {
  host: string;
  segment: number | null;
  startedAt: number;
  endsAt: number;
}

export function pickSegment(rng: Rng): number {
  const total = WHEEL_SEGMENTS.reduce((a, s) => a + s.weight, 0);
  let r = rng(total);
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    r -= WHEEL_SEGMENTS[i].weight;
    if (r < 0) return i;
  }
  return 0;
}

export const wheel: MinigameDef<WheelState> = {
  start: c => ({ host: c.host, segment: null, startedAt: c.now, endsAt: c.now + WHEEL_MS }),
  players: s => [s.host],
  move(s, _id, m, c) {
    if (m.kind !== 'spin') reject('Spin the wheel');
    if (s.segment !== null) reject('Already spun');
    s.segment = pickSegment(c.rng);
  },
  deadline: s => s.endsAt,
  tick(s, c) { s.segment ??= pickSegment(c.rng); },
  done: s => s.segment !== null,
  outcome(s, n) {
    const seg = WHEEL_SEGMENTS[s.segment!];
    const who = n.name(s.host);
    if (seg.jailCard) return { headline: `${who} spun a Get Out of Jail Free card!`, payouts: [{ player: s.host, amount: 0, jailCard: true }] };
    if (seg.amount < 0) return { headline: `Ouch — ${who} has to pay ${n.money(-seg.amount)}.`, payouts: [{ player: s.host, amount: seg.amount }] };
    return { headline: `${who} spun ${n.money(seg.amount)}${seg.amount >= 250 ? ' — JACKPOT!' : '!'}`, payouts: [{ player: s.host, amount: seg.amount }] };
  },
  body: s => ({ kind: 'wheel', segment: s.segment }),
  publicEndsAt: s => s.endsAt,
  drop: () => true,
  shift(s, ms) { s.startedAt += ms; s.endsAt += ms; },
  bot(s, _id, c) {
    if (s.segment !== null) return null;
    return c.now - s.startedAt >= jitter(c.seed, 900, 2000) ? { kind: 'spin' } : null;
  },
  // Long enough for the client's spin animation plus a moment to read the result.
  resultMs: 6_500,
};
