// Helpers for the card game tests: stacked decks, a scripted clock, and card
// specs. A spec names a card: 'r5' red 5, 'gS' green Skip, 'bR' blue Reverse,
// 'y+2' yellow Draw Two, 'W' Wild, 'W4' Wild Draw Four.
import assert from 'node:assert/strict';
import { CardsError, CardsGame, type CardsNewPlayer, type Rng } from '../src/cards/game.ts';
import { CARDS_DECK_SIZE, CARDS_HAND_SIZE } from '../../shared/cards/meta.ts';
import { buildDeck, type Card } from '../../shared/cards/deck.ts';
import type { CardsRules } from '../../shared/cards/rules.ts';
import type { CardsAction, CardsBotLevel } from '../../shared/cards/types.ts';

const COLORS: Record<string, Card['color']> = { r: 'red', y: 'yellow', g: 'green', b: 'blue' };

export function matcher(spec: string): (c: Card) => boolean {
  if (spec === 'W') return c => c.kind === 'wild';
  if (spec === 'W4') return c => c.kind === 'wild4';
  const color = COLORS[spec[0]];
  if (!color) throw new Error(`bad spec ${spec}`);
  const rest = spec.slice(1);
  if (rest === 'S') return c => c.kind === 'skip' && c.color === color;
  if (rest === 'R') return c => c.kind === 'reverse' && c.color === color;
  if (rest === '+2') return c => c.kind === 'draw2' && c.color === color;
  const value = Number(rest);
  if (!Number.isInteger(value)) throw new Error(`bad spec ${spec}`);
  return c => c.kind === 'number' && c.color === color && c.value === value;
}

/** Remove and return a card matching `spec` from `pool`. */
export function take(pool: Card[], spec: string): Card {
  const i = pool.findIndex(matcher(spec));
  if (i < 0) throw new Error(`no ${spec} left in the deck`);
  return pool.splice(i, 1)[0];
}

/**
 * An rng that makes the engine's shuffle of buildDeck() come out as `order`
 * (card ids, bottom of the pile first). Later shuffles keep their order.
 */
export function rngFor(order: number[]): Rng {
  const a = Array.from({ length: order.length }, (_, i) => i);
  const queue: number[] = [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = a.indexOf(order[i]);
    queue.push(j);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return k => (queue.length ? queue.shift()! : k - 1);
}

/** Seeded PRNG (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return (n: number) => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

export interface TableOpts {
  rules?: Partial<CardsRules>;
  /** Per seat, up to 7 specs (the rest are filled with low number cards in sevens order). */
  hands?: string[][];
  /** The start card(s): Wild Draw Fours first go back to the bottom. Default: a green 9. */
  flip?: string[];
  /** The next cards drawn after the deal, in draw order. */
  draws?: string[];
  /** Which seats are bots (with optional levels). */
  bots?: Record<number, CardsBotLevel | true>;
}

/**
 * A game with a stacked deck, on the official rules (stacking off) unless
 * `rules` says otherwise. Seat i is player `p${i}`; the dealer is the last
 * seat, so p0 plays first unless the start card says otherwise.
 */
export function table(n = 3, o: TableOpts = {}) {
  let clock = 1_000_000;
  const pool = buildDeck();
  const hands = Array.from({ length: n }, (_, s) => (o.hands?.[s] ?? []).map(sp => take(pool, sp)));
  // Fill with cards that rarely matter: yellow numbers (no 0, 7 or 9: no 7-0
  // effects, no match on the default green 9), then any such number. Tests
  // that rely on fillers never matching keep yellow off the table.
  // Then 8s and 6s, so the low numbers tests like to name stay in the pile.
  const plain = (c: Card) => c.kind === 'number' && c.value !== 0 && c.value !== 7 && c.value !== 9;
  const prefs: ((c: Card) => boolean)[] = [
    c => plain(c) && c.color === 'yellow', c => plain(c) && c.value === 8, c => plain(c) && c.value === 6, plain,
  ];
  const filler = () => {
    for (const ok of prefs) {
      const i = pool.findIndex(ok);
      if (i >= 0) return pool.splice(i, 1)[0];
    }
    throw new Error('out of filler cards');
  };
  for (const h of hands) while (h.length < CARDS_HAND_SIZE) h.push(filler());
  const popOrder: Card[] = [];
  for (let k = 0; k < CARDS_HAND_SIZE; k++) for (const h of hands) popOrder.push(h[k]);
  for (const sp of o.flip ?? ['g9']) popOrder.push(take(pool, sp));
  for (const sp of o.draws ?? []) popOrder.push(take(pool, sp));
  popOrder.push(...pool);
  const order = popOrder.map(c => c.id).reverse();
  assert.equal(order.length, CARDS_DECK_SIZE);
  const players: CardsNewPlayer[] = Array.from({ length: n }, (_, i) => {
    const bot = o.bots?.[i];
    return { id: `p${i}`, name: `P${i}`, isBot: !!bot, ...(typeof bot === 'string' && { level: bot }) };
  });
  const g = new CardsGame({ players, rules: { stacking: false, ...o.rules }, rng: rngFor(order), now: () => clock });
  return {
    g,
    now: () => clock,
    tick(ms: number) { clock += ms; },
    act(id: string, a: CardsAction) { g.apply(id, a); },
    /** Id of a card matching `spec` in `id`'s hand. */
    card(id: string, spec: string): number {
      const c = g.player(id).hand.find(matcher(spec));
      if (!c) throw new Error(`${id} holds no ${spec}`);
      return c.id;
    },
    /** Play the card matching `spec` from `id`'s hand. */
    play(id: string, spec: string, extra: Partial<Extract<CardsAction, { type: 'play' }>> = {}) {
      const c = g.player(id).hand.find(matcher(spec));
      if (!c) throw new Error(`${id} holds no ${spec}`);
      g.apply(id, { type: 'play', card: c.id, ...extra });
    },
  };
}

/** Every one of the 108 cards is somewhere, exactly once. */
export function assertConserved(g: CardsGame, where = '') {
  const ids = [...g.pile, ...g.discard, ...g.players.flatMap(p => p.hand)].map(c => c.id);
  assert.equal(ids.length, CARDS_DECK_SIZE, `card count ${where}`);
  assert.equal(new Set(ids).size, CARDS_DECK_SIZE, `duplicate card ${where}`);
}

/** A refused action must leave the game exactly as it was. */
export function assertRefused(g: CardsGame, fn: () => void, msg?: RegExp) {
  const before = JSON.stringify(g.snapshot(), (k, v) => (k === 'savedAt' ? undefined : v));
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof CardsError, `not a CardsError: ${e}`);
    if (msg) assert.match(e.message, msg);
    return true;
  });
  const after = JSON.stringify(g.snapshot(), (k, v) => (k === 'savedAt' ? undefined : v));
  assert.equal(after, before, 'a refused action changed the game');
}

/** Pull the card matching `spec` out of the draw pile (or, failing that, from a hand other than `keep`'s). */
function fromPile(g: CardsGame, spec: string, keep?: string): Card {
  const i = g.pile.findIndex(matcher(spec));
  if (i >= 0) return g.pile.splice(i, 1)[0];
  if (keep === undefined) throw new Error(`no ${spec} in the draw pile`);
  for (const p of g.players) {
    if (p.id === keep) continue;
    const j = p.hand.findIndex(matcher(spec));
    if (j >= 0) return p.hand.splice(j, 1)[0];
  }
  throw new Error(`no ${spec} left to take`);
}

/** Give `id` exactly these cards (from the draw pile; their old hand goes back under it). */
export function setHand(g: CardsGame, id: string, hand: string[]) {
  const p = g.player(id);
  g.pile.unshift(...p.hand);
  p.hand = [];
  p.hand = hand.map(sp => fromPile(g, sp, id));
}

/** Put these cards on top of the draw pile, so they are drawn in this order. */
export function putOnTop(g: CardsGame, ...cards: string[]) {
  for (const sp of [...cards].reverse()) g.pile.push(fromPile(g, sp));
}

/** Play this card from the draw pile onto the table (its colour comes into play). */
export function setTop(g: CardsGame, spec: string) {
  const c = fromPile(g, spec);
  g.discard.push(c);
  if (c.color) g.color = c.color;
}

export function specs(g: CardsGame, id: string): string[] {
  return g.player(id).hand.map(c => {
    if (c.kind === 'wild') return 'W';
    if (c.kind === 'wild4') return 'W4';
    const k = c.kind === 'number' ? String(c.value) : c.kind === 'skip' ? 'S' : c.kind === 'reverse' ? 'R' : '+2';
    return c.color![0] + k;
  });
}
