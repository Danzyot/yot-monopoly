// Poker hand maths for the hub (the Poker Daily, server/src/poker/): cards,
// a 5-to-7-card hand evaluator, the Chen formula for ranking starting hands,
// and the hand's name. Poker itself (poker/) is a separate build, so nothing
// here imports from it: evaluate5 is copied from poker/server/src/engine/evaluator.ts
// (same scores), and `evaluate` is a faster any-5-to-7-card version tested
// against it (server/test/pokerHands.test.ts).
//
// A card is a number 0..51: rank index = card >> 2 (0 = deuce .. 12 = ace),
// suit = card & 3 (0 ♠, 1 ♥, 2 ♦, 3 ♣, the same order as poker's).

export type Card = number;

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;

export const card = (rankIdx: number, suit: number): Card => (rankIdx << 2) | suit;
export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;

/** "As" → the ace of spades. Throws on anything else. */
export function parseCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0]?.toUpperCase() ?? '');
  const u = SUIT_CHARS.indexOf(s[1]?.toLowerCase() ?? '');
  if (s.length !== 2 || r < 0 || u < 0) throw new Error(`Not a card: ${s}`);
  return card(r, u);
}

/** "As Kd 7c" → three cards. */
export function parseCards(s: string): Card[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

/** The ace of spades → "As" (what the API sends; the client draws it). */
export function cardCode(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

/** "As" → "A♠" (for text: the share line, the explanations). */
export function cardText(c: Card): string {
  const r = RANK_CHARS[rankOf(c)];
  return `${r === 'T' ? '10' : r}${SUIT_SYMBOLS[suitOf(c)]}`;
}

// ---- the evaluator ----

/** Hand categories, higher is better. */
export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
} as const;

/** A comparable integer: (category << 20) | up to five ranks (2..14) packed 4 bits each. */
function pack(cat: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return (cat << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;
}

/** Five cards, the straightforward way (poker's own evaluate5, on these card numbers). */
export function evaluate5(cards: Card[]): number {
  const ranks = cards.map(c => rankOf(c) + 2).sort((a, b) => b - a);
  const isFlush = cards.every(c => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // the wheel
  }
  if (isFlush && straightHigh) return pack(CAT.STRAIGHT_FLUSH, straightHigh);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const g = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (g[0][1] === 4) return pack(CAT.QUADS, g[0][0], g[1][0]);
  if (g[0][1] === 3 && g[1][1] === 2) return pack(CAT.FULL_HOUSE, g[0][0], g[1][0]);
  if (isFlush) return pack(CAT.FLUSH, ...ranks);
  if (straightHigh) return pack(CAT.STRAIGHT, straightHigh);
  if (g[0][1] === 3) return pack(CAT.TRIPS, g[0][0], g[1][0], g[2][0]);
  if (g[0][1] === 2 && g[1][1] === 2) return pack(CAT.TWO_PAIR, g[0][0], g[1][0], g[2][0]);
  if (g[0][1] === 2) return pack(CAT.PAIR, g[0][0], g[1][0], g[2][0], g[3][0]);
  return pack(CAT.HIGH, ...ranks);
}

/** The best five out of 5–7, by trying every five (the reference the fast one is tested against). */
export function evaluateSlow(cards: Card[]): number {
  if (cards.length === 5) return evaluate5(cards);
  let best = -1;
  const pick: Card[] = [];
  const rec = (start: number) => {
    if (pick.length === 5) { best = Math.max(best, evaluate5(pick)); return; }
    for (let i = start; i <= cards.length - (5 - pick.length); i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best;
}

/** The highest straight in a 13-bit rank mask, as its top card (2..14; 5 for the wheel), or 0. */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) if (((mask >> (top - 4)) & 0x1f) === 0x1f) return top + 2;
  return (mask & 0x100f) === 0x100f ? 5 : 0;
}

const counts = new Uint8Array(13);
const suitMasks = new Int32Array(4);

/** The `k` highest ranks (2..14) in `mask`, skipping `skip` ranks' bits, into `out`. */
function topRanks(mask: number, k: number, out: number[]): void {
  out.length = 0;
  for (let r = 12; r >= 0 && out.length < k; r--) if (mask & (1 << r)) out.push(r + 2);
  while (out.length < 5) out.push(0);
}
const tmp: number[] = [];

/** The best five-card hand out of the first `n` (5 to 7) of `cards`. Same scores as evaluate5. */
export function evaluate(cards: ArrayLike<Card>, n: number = cards.length): number {
  counts.fill(0);
  suitMasks.fill(0);
  let all = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    counts[r]++;
    suitMasks[c & 3] |= 1 << r;
    all |= 1 << r;
  }
  let flush = 0;
  for (let s = 0; s < 4; s++) {
    const m = suitMasks[s];
    if (popcount(m) >= 5) {
      const sf = straightTop(m);
      if (sf) return pack(CAT.STRAIGHT_FLUSH, sf);
      flush = m;
    }
  }
  let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1, singles = 0;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; else singles |= 1 << r; }
    else if (k === 1) singles |= 1 << r;
  }
  if (quad >= 0) {
    topRanks(all & ~(1 << quad), 1, tmp);
    return pack(CAT.QUADS, quad + 2, tmp[0]);
  }
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return pack(CAT.FULL_HOUSE, t1 + 2, Math.max(t2, p1) + 2);
  if (flush) {
    topRanks(flush, 5, tmp);
    return pack(CAT.FLUSH, tmp[0], tmp[1], tmp[2], tmp[3], tmp[4]);
  }
  const st = straightTop(all);
  if (st) return pack(CAT.STRAIGHT, st);
  if (t1 >= 0) {
    topRanks(singles, 2, tmp);
    return pack(CAT.TRIPS, t1 + 2, tmp[0], tmp[1]);
  }
  if (p2 >= 0) {
    topRanks(singles, 1, tmp);
    return pack(CAT.TWO_PAIR, p1 + 2, p2 + 2, tmp[0]);
  }
  if (p1 >= 0) {
    topRanks(singles, 3, tmp);
    return pack(CAT.PAIR, p1 + 2, tmp[0], tmp[1], tmp[2]);
  }
  topRanks(singles, 5, tmp);
  return pack(CAT.HIGH, tmp[0], tmp[1], tmp[2], tmp[3], tmp[4]);
}

function popcount(m: number): number {
  let n = 0;
  while (m) { m &= m - 1; n++; }
  return n;
}

export function categoryOf(score: number): number {
  return score >> 20;
}

const CAT_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

/** "Two pair", "Flush" (a royal flush by name). */
export function handName(score: number): string {
  const cat = categoryOf(score);
  if (cat === CAT.STRAIGHT_FLUSH && ((score >> 16) & 0xf) === 14) return 'Royal flush';
  return CAT_NAMES[cat] ?? 'High card';
}

/**
 * Flush and straight draws a two-card hand has on a board of 3 or 4 (river: none):
 * 2 for a flush draw or an open-ended straight draw (or two gutshots), 1 for a gutshot,
 * the most of either. Only draws that use one of the hand's own cards count.
 */
export function drawScore(hole: [Card, Card], board: Card[]): number {
  if (board.length < 3 || board.length > 4) return 0;
  const cards = [...hole, ...board];
  let best = 0;
  for (let s = 0; s < 4; s++) {
    const n = cards.filter(c => suitOf(c) === s).length;
    if (n === 4 && hole.some(c => suitOf(c) === s)) best = 2;
  }
  let mask = 0;
  for (const c of cards) mask |= 1 << rankOf(c);
  if (straightTop(mask)) return best; // already a straight
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const top = straightTop(mask | (1 << r));
    if (!top) continue;
    // The straight must use a hole card: take the hole cards' ranks out and it is gone.
    const boardMask = board.reduce((m, c) => m | (1 << rankOf(c)), 0);
    if (straightTop(boardMask | (1 << r)) === top) continue;
    outs++;
  }
  return Math.max(best, outs >= 2 ? 2 : outs);
}

// ---- starting hands ----

/** The Chen formula: a well-known score for a starting hand (−1 for 72o up to 20 for AA). */
export function chen(a: Card, b: Card): number {
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const pts = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (hi === lo) return Math.max(5, pts(hi) * 2);
  let s = pts(hi);
  if (suitOf(a) === suitOf(b)) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1;
  return Math.ceil(s);
}

export type Combo = [Card, Card];

/** All 1,326 two-card hands, best first by the Chen formula (then the higher cards, then suited). */
export const ALL_COMBOS: readonly Combo[] = (() => {
  const out: { c: Combo; key: number }[] = [];
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      const hi = Math.max(rankOf(a), rankOf(b));
      const lo = Math.min(rankOf(a), rankOf(b));
      const key = chen(a, b) * 10_000 + hi * 400 + lo * 20 + (suitOf(a) === suitOf(b) ? 1 : 0) * 10 + (3 - suitOf(a));
      out.push({ c: [Math.max(a, b), Math.min(a, b)], key });
    }
  }
  out.sort((x, y) => y.key - x.key || y.c[0] - x.c[0] || y.c[1] - x.c[1]);
  return out.map(o => o.c);
})();

/** The best `pct` (0..1) of all starting hands, by the Chen formula. */
export function topRange(pct: number): Combo[] {
  return ALL_COMBOS.slice(0, Math.round(Math.max(0, Math.min(1, pct)) * ALL_COMBOS.length));
}

/** "AKs", "QJo", "88" (the usual starting-hand shorthand). */
export function comboClass(c: Combo): string {
  const [a, b] = rankOf(c[0]) >= rankOf(c[1]) ? c : [c[1], c[0]];
  const ra = RANK_CHARS[rankOf(a)], rb = RANK_CHARS[rankOf(b)];
  if (ra === rb) return ra + rb;
  return ra + rb + (suitOf(a) === suitOf(b) ? 's' : 'o');
}
