// High or Low: solo. A card is turned; the lander guesses whether the next
// is higher or lower (ace low, king high, same rank counts as right). Each
// right guess doubles the prize up to the cap, a wrong one loses it, and the
// lander may cash out whenever they like. The shuffled deck lives only here —
// the view shows cards already turned, never the next one.

import { cardRank } from '../../../../shared/minigames.ts';
import { jitter, reject, shuffle, type MinigameDef } from './types.ts';

export const HIGHLOW_START = 50;
export const HIGHLOW_MAX = 400;
/** Time to make each decision; running out banks what you hold. */
export const HIGHLOW_STEP_MS = 7_000;

export interface HighLowState {
  host: string;
  /** Hidden: the rest of the deck, drawn from the end. */
  deck: number[];
  cards: number[];
  prize: number;
  outcome: 'bust' | 'cashed' | null;
  stepAt: number;
  endsAt: number;
}

/** Chance that guessing `dir` is right given only the cards already shown. */
export function oddsOf(cards: number[], dir: 'higher' | 'lower'): number {
  const r = cardRank(cards[cards.length - 1]);
  const seen = new Set(cards);
  let good = 0, left = 0;
  for (let c = 0; c < 52; c++) {
    if (seen.has(c)) continue;
    left++;
    const k = cardRank(c);
    if (dir === 'higher' ? k >= r : k <= r) good++;
  }
  return left ? good / left : 0;
}

export const highLow: MinigameDef<HighLowState> = {
  start(c) {
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), c.rng);
    const first = deck.pop()!;
    return {
      host: c.host, deck, cards: [first], prize: HIGHLOW_START, outcome: null,
      stepAt: c.now, endsAt: c.now + HIGHLOW_STEP_MS,
    };
  },
  players: s => [s.host],
  move(s, _id, m, c) {
    if (s.outcome) reject('This round is over');
    if (m.kind === 'cashOut') {
      s.outcome = 'cashed';
      return;
    }
    if (m.kind !== 'higher' && m.kind !== 'lower') reject('Guess higher or lower, or cash out');
    const cur = cardRank(s.cards[s.cards.length - 1]);
    const next = s.deck.pop()!;
    s.cards.push(next);
    const k = cardRank(next);
    const right = m.kind === 'higher' ? k >= cur : k <= cur;
    if (!right) {
      s.outcome = 'bust';
      return;
    }
    s.prize = Math.min(HIGHLOW_MAX, s.prize * 2);
    if (s.prize >= HIGHLOW_MAX) s.outcome = 'cashed';
    s.stepAt = c.now;
    s.endsAt = c.now + HIGHLOW_STEP_MS;
  },
  deadline: s => s.endsAt,
  tick(s) {
    s.outcome ??= 'cashed';
  },
  done: s => s.outcome !== null,
  outcome(s, n) {
    const who = n.name(s.host);
    if (s.outcome === 'bust') return { headline: `${who} guessed wrong and lost ${n.money(s.prize)}.`, payouts: [] };
    return {
      headline: s.prize >= HIGHLOW_MAX ? `${who} ran the table: ${n.money(s.prize)}!` : `${who} cashed out ${n.money(s.prize)}.`,
      payouts: [{ player: s.host, amount: s.prize }],
    };
  },
  body: s => ({ kind: 'highLow', cards: s.cards, prize: s.prize, maxPrize: HIGHLOW_MAX, outcome: s.outcome }),
  publicEndsAt: s => s.endsAt,
  drop: () => true,
  shift(s, ms) { s.stepAt += ms; s.endsAt += ms; },
  bot(s, _id, c) {
    if (s.outcome || c.now - s.stepAt < jitter(c.seed, 1400, 2800, s.cards.length)) return null;
    // Only public information: which cards have been shown.
    const hi = oddsOf(s.cards, 'higher'), lo = oddsOf(s.cards, 'lower');
    const best = Math.max(hi, lo);
    const nerve = s.prize >= 200 ? 0.8 : s.prize >= 100 ? 0.62 : 0.5;
    if (best < nerve) return { kind: 'cashOut' };
    return { kind: hi >= lo ? 'higher' : 'lower' };
  },
  resultMs: 4_000,
};
