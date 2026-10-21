// How often a hand wins against each hand in a range (ties count half), for
// the Poker Daily's EV maths (server/src/poker/spots.ts). With one card or
// none still to come every runout is counted (exact); before that, runouts are
// sampled (Monte Carlo) from a seeded generator, so the same seed always gives
// the same numbers.
import { evaluate, type Card, type Combo } from './hands.ts';

/** A seeded generator of floats in [0, 1): sfc32 over a 128-bit hash of the seed. */
export function makeRng(seed: string): () => number {
  // cyrb128: four 32-bit words from the string.
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

/** An integer in [0, n). */
export const pick = (rng: () => number, n: number): number => Math.floor(rng() * n);

/** Fisher–Yates, in place. */
export function shuffle<T>(rng: () => number, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Whether a two-card hand shares a card with `dead`. */
export const blocked = (c: Combo, dead: ReadonlySet<Card>): boolean => dead.has(c[0]) || dead.has(c[1]);

export interface EquityOpts {
  /** Runouts sampled in all (spread evenly over the range) when two or more cards are still to come. */
  samples?: number;
}

/**
 * The hero's share of the pot against each hand in `range`, with `board` (0, 3, 4 or 5 cards)
 * so far. Hands that share a card with the hero or the board get NaN (they cannot be held).
 */
export function equityByCombo(hero: Combo, board: Card[], range: readonly Combo[], rng: () => number, opts: EquityOpts = {}): Float64Array {
  const out = new Float64Array(range.length).fill(NaN);
  const dead = new Set<Card>([...hero, ...board]);
  const live = range.map((c, i) => (blocked(c, dead) ? -1 : i)).filter(i => i >= 0);
  if (!live.length) return out;
  const toCome = 5 - board.length;
  const h = new Int32Array(7);
  const v = new Int32Array(7);
  h[0] = hero[0]; h[1] = hero[1];
  for (let i = 0; i < board.length; i++) { h[2 + i] = board[i]; v[2 + i] = board[i]; }
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);

  if (toCome <= 1) {
    for (const i of live) {
      const [a, b] = range[i];
      v[0] = a; v[1] = b;
      let won = 0, n = 0;
      if (toCome === 0) {
        const hs = evaluate(h, 7), vs = evaluate(v, 7);
        won = hs > vs ? 1 : hs === vs ? 0.5 : 0;
        n = 1;
      } else {
        for (const c of deck) {
          if (c === a || c === b) continue;
          h[6] = c; v[6] = c;
          const hs = evaluate(h, 7), vs = evaluate(v, 7);
          won += hs > vs ? 1 : hs === vs ? 0.5 : 0;
          n++;
        }
      }
      out[i] = won / n;
    }
    return out;
  }

  const per = Math.max(8, Math.ceil((opts.samples ?? 20_000) / live.length));
  const pool: Card[] = new Array(deck.length);
  for (const i of live) {
    const [a, b] = range[i];
    v[0] = a; v[1] = b;
    let m = 0;
    for (const c of deck) if (c !== a && c !== b) pool[m++] = c;
    let won = 0;
    for (let s = 0; s < per; s++) {
      // A partial shuffle: the last `toCome` places of the pool get the runout.
      for (let k = 0; k < toCome; k++) {
        const j = pick(rng, m - k);
        const last = m - 1 - k;
        const t = pool[j]; pool[j] = pool[last]; pool[last] = t;
        h[2 + board.length + k] = t;
        v[2 + board.length + k] = t;
      }
      const hs = evaluate(h, 7), vs = evaluate(v, 7);
      won += hs > vs ? 1 : hs === vs ? 0.5 : 0;
    }
    out[i] = won / per;
  }
  return out;
}

/** The average of `eq` over the hands picked by `use` (NaN entries, the blocked hands, skipped); NaN if none. */
export function meanEquity(eq: Float64Array, use: (i: number) => boolean = () => true): number {
  let s = 0, n = 0;
  for (let i = 0; i < eq.length; i++) {
    if (!use(i) || Number.isNaN(eq[i])) continue;
    s += eq[i];
    n++;
  }
  return n ? s / n : NaN;
}

/** The hero's equity against a whole range. */
export function equityVsRange(hero: Combo, board: Card[], range: readonly Combo[], rng: () => number, opts?: EquityOpts): number {
  return meanEquity(equityByCombo(hero, board, range, rng, opts));
}
