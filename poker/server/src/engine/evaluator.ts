import type { CardT } from '../../../shared/types.ts';

// Hand categories, higher is better.
export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
} as const;

const RANK_NAMES: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const RANK_PLURAL: Record<number, string> = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights',
  9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
};

// Score is a comparable integer: (category << 20) | kickers packed 4 bits each.
function pack(cat: number, ranks: number[]): number {
  let v = cat << 20;
  for (let i = 0; i < 5; i++) v |= (ranks[i] ?? 0) << (16 - 4 * i);
  return v;
}

export function evaluate5(cards: CardT[]): number {
  const ranks = cards.map(c => c.r).sort((a, b) => b - a);
  const isFlush = cards.every(c => c.s === cards[0].s);

  // Straight detection (with wheel A-5).
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  if (isFlush && straightHigh) return pack(CAT.STRAIGHT_FLUSH, [straightHigh]);

  // Count ranks.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Sort by count desc, then rank desc.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (groups[0][1] === 4) return pack(CAT.QUADS, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return pack(CAT.FULL_HOUSE, [groups[0][0], groups[1][0]]);
  if (isFlush) return pack(CAT.FLUSH, ranks);
  if (straightHigh) return pack(CAT.STRAIGHT, [straightHigh]);
  if (groups[0][1] === 3) return pack(CAT.TRIPS, [groups[0][0], groups[1][0], groups[2][0]]);
  if (groups[0][1] === 2 && groups[1][1] === 2) return pack(CAT.TWO_PAIR, [groups[0][0], groups[1][0], groups[2][0]]);
  if (groups[0][1] === 2) return pack(CAT.PAIR, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]);
  return pack(CAT.HIGH, ranks);
}

// Best 5-card hand from 7 (or 5/6) cards.
// The specific five cards that make the best hand out of 5-7 cards.
export function bestFiveOf(cards: CardT[]): CardT[] {
  if (cards.length <= 5) return [...cards];
  let best = -1;
  let bestCombo: CardT[] = [];
  const n = cards.length;
  const combo: CardT[] = new Array(5);
  const rec = (start: number, depth: number) => {
    if (depth === 5) {
      const v = evaluate5(combo);
      if (v > best) { best = v; bestCombo = [...combo]; }
      return;
    }
    for (let i = start; i <= n - (5 - depth); i++) {
      combo[depth] = cards[i];
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
  return bestCombo;
}

export function evaluate7(cards: CardT[]): number {
  if (cards.length === 5) return evaluate5(cards);
  let best = -1;
  const n = cards.length;
  // choose 5 of n
  const idx = [0, 1, 2, 3, 4];
  const combo: CardT[] = new Array(5);
  const rec = (start: number, depth: number) => {
    if (depth === 5) {
      const v = evaluate5(combo);
      if (v > best) best = v;
      return;
    }
    for (let i = start; i <= n - (5 - depth); i++) {
      combo[depth] = cards[i];
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
  void idx;
  return best;
}

export function categoryOf(score: number): number {
  return score >> 20;
}

function kickersOf(score: number): number[] {
  const ks: number[] = [];
  for (let i = 0; i < 5; i++) ks.push((score >> (16 - 4 * i)) & 0xf);
  return ks;
}

// Live description of a partial hand (hole cards + any number of board cards).
export function describeCards(hole: CardT[], board: CardT[]): string {
  const all = [...hole, ...board];
  if (all.length >= 5) return handName(evaluate7(all));
  // Preflop (or degenerate): pair or high card.
  if (hole.length === 2 && hole[0].r === hole[1].r) return 'Pair';
  return 'High Card';
}

// Just the hand's name — "Pair", "Flush" — never the specific cards.
export function handName(score: number): string {
  const cat = categoryOf(score);
  const k = kickersOf(score);
  switch (cat) {
    case CAT.STRAIGHT_FLUSH: return k[0] === 14 ? 'Royal Flush' : 'Straight Flush';
    case CAT.QUADS: return 'Four of a Kind';
    case CAT.FULL_HOUSE: return 'Full House';
    case CAT.FLUSH: return 'Flush';
    case CAT.STRAIGHT: return 'Straight';
    case CAT.TRIPS: return 'Three of a Kind';
    case CAT.TWO_PAIR: return 'Two Pair';
    case CAT.PAIR: return 'Pair';
    default: return 'High Card';
  }
}
