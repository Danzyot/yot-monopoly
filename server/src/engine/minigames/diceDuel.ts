// Dice Duel: the lander against one random opponent. Each presses Roll; the
// higher two-dice total takes the prize from the bank, a tie splits it. Nobody
// can stall it — whoever hasn't rolled when the clock runs out is rolled for.

import { jitter, reject, type MinigameDef } from './types.ts';

export const DUEL_PRIZE = 100;
export const DUEL_MS = 10_000;

export interface DuelState {
  host: string;
  opponent: string;
  prize: number;
  rolls: Record<string, [number, number]>;
  startedAt: number;
  endsAt: number;
}

const total = (r: [number, number]) => r[0] + r[1];

export const diceDuel: MinigameDef<DuelState> = {
  start: c => ({
    host: c.host,
    opponent: c.others[c.rng(c.others.length)],
    prize: DUEL_PRIZE,
    rolls: {},
    startedAt: c.now,
    endsAt: c.now + DUEL_MS,
  }),
  players: s => [s.host, s.opponent],
  move(s, id, m, c) {
    if (m.kind !== 'roll') reject('Press Roll');
    if (s.rolls[id]) reject('You already rolled');
    s.rolls[id] = [c.rng(6) + 1, c.rng(6) + 1];
  },
  deadline: s => s.endsAt,
  tick(s, c) {
    for (const id of [s.host, s.opponent]) s.rolls[id] ??= [c.rng(6) + 1, c.rng(6) + 1];
  },
  done: s => !!s.rolls[s.host] && !!s.rolls[s.opponent],
  outcome(s, n) {
    const a = total(s.rolls[s.host]), b = total(s.rolls[s.opponent]);
    const vs = `${n.name(s.host)} ${a} vs ${n.name(s.opponent)} ${b}`;
    if (a === b) {
      const half = Math.floor(s.prize / 2);
      return { headline: `${vs} — a tie, the prize is split.`, payouts: [{ player: s.host, amount: half }, { player: s.opponent, amount: half }] };
    }
    const w = a > b ? s.host : s.opponent;
    return { headline: `${vs} — ${n.name(w)} wins!`, payouts: [{ player: w, amount: s.prize }] };
  },
  body: s => ({ kind: 'diceDuel', opponent: s.opponent, prize: s.prize, rolls: s.rolls }),
  publicEndsAt: s => s.endsAt,
  drop: () => true,
  shift(s, ms) { s.startedAt += ms; s.endsAt += ms; },
  bot(s, id, c) {
    if (s.rolls[id]) return null;
    return c.now - s.startedAt >= jitter(c.seed, 1200, 2600) ? { kind: 'roll' } : null;
  },
  resultMs: 4_000,
};
