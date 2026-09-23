// Quick Math: everyone still in the game gets the same sum and four choices.
// The first correct answer wins; a wrong answer locks you out of the round.
// The answer stays on the server until the round is decided (the question
// makes it derivable, of course — that's the game — but it's never sent).

import { jitter, reject, shuffle, type MinigameDef, type Rng } from './types.ts';

export const MATH_PRIZE = 100;
export const MATH_MS = 12_000;

export interface MathState {
  players: string[];
  question: string;
  /** Hidden until the round is over. */
  answer: number;
  options: number[];
  locked: string[];
  winner: string | null;
  startedAt: number;
  endsAt: number;
  expired: boolean;
}

/** A sum a person can do in their head in a few seconds, plus three plausible wrong answers. */
export function makeQuestion(rng: Rng): { question: string; answer: number; options: number[] } {
  let question: string, answer: number, near: number[];
  switch (rng(3)) {
    case 0: {
      const a = 11 + rng(79), b = 11 + rng(79);
      question = `${a} + ${b}`; answer = a + b; near = [1, 2, 10, 11, 9];
      break;
    }
    case 1: {
      const a = 30 + rng(70), b = 5 + rng(a - 10);
      question = `${a} − ${b}`; answer = a - b; near = [1, 2, 10, 11, 9];
      break;
    }
    default: {
      const a = 3 + rng(10), b = 3 + rng(10);
      question = `${a} × ${b}`; answer = a * b; near = [a, b, 1, 2, 10];
      break;
    }
  }
  const wrong = new Set<number>();
  for (const d of shuffle([...near, ...near.map(x => -x)], rng)) {
    const v = answer + d;
    if (v > 0 && v !== answer) wrong.add(v);
    if (wrong.size === 3) break;
  }
  return { question, answer, options: shuffle([answer, ...wrong], rng) };
}

const decided = (s: MathState) => !!s.winner || s.expired || s.players.every(id => s.locked.includes(id));

export const quickMath: MinigameDef<MathState> = {
  start(c) {
    const q = makeQuestion(c.rng);
    return {
      players: [c.host, ...c.others], ...q, locked: [], winner: null,
      startedAt: c.now, endsAt: c.now + MATH_MS, expired: false,
    };
  },
  players: s => s.players,
  move(s, id, m, c) {
    if (m.kind !== 'answer') reject('Pick an answer');
    if (!Number.isFinite(m.value)) reject('Bad answer');
    if (s.locked.includes(id)) reject('You are locked out this round');
    if (decided(s) || c.now > s.endsAt) reject('Too late');
    if (m.value === s.answer) s.winner = id;
    else s.locked.push(id);
  },
  deadline: s => s.endsAt,
  tick(s) { s.expired = true; },
  done: decided,
  outcome(s, n) {
    const sum = `${s.question} = ${s.answer}`;
    if (s.winner) return { headline: `${n.name(s.winner)} got it first: ${sum}.`, payouts: [{ player: s.winner, amount: MATH_PRIZE }] };
    return { headline: `Nobody got it — ${sum}.`, payouts: [] };
  },
  body: s => ({
    kind: 'quickMath', question: s.question, options: s.options, prize: MATH_PRIZE,
    locked: s.locked, winner: s.winner, answer: decided(s) ? s.answer : null,
  }),
  publicEndsAt: s => s.endsAt,
  drop(s, id) {
    s.players = s.players.filter(p => p !== id);
    s.locked = s.locked.filter(p => p !== id);
    return s.players.length === 0;
  },
  shift(s, ms) { s.startedAt += ms; s.endsAt += ms; },
  bot(s, id, c) {
    if (decided(s) || s.locked.includes(id) || c.now > s.endsAt) return null;
    if (c.now - s.startedAt < jitter(c.seed, 2800, 6500)) return null;
    // Bots are good at sums, not perfect: roughly one in six picks a wrong option.
    const wrong = s.options.filter(v => v !== s.answer);
    const slip = jitter(c.seed, 0, 99, 'slip') < 16;
    return { kind: 'answer', value: slip ? wrong[jitter(c.seed, 0, wrong.length - 1, 'pick')] : s.answer };
  },
  resultMs: 4_500,
};
