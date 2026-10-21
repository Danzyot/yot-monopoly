// The decks and the pure card rules both sides need: what matches, what a
// card is worth, what it is called. Every physical card has a stable id (its
// position in the deck: 0–107 in Classic, the same 108 then 27 more in Chog
// Chaos) so the server can prove none is ever lost or duplicated and the
// client can animate one card from pile to hand to table.

import { CARDS_CHAOS_DECK_SIZE, CARDS_DECK_SIZE } from './meta.ts';

export const CARD_COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export type CardKind =
  | 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'
  // Chog Chaos only:
  | 'purge'    // coloured: every other card of its colour leaves your hand with it
  | 'blitz'    // coloured: everyone else is skipped, you go again
  | 'wild6'    // Gas Spike: a Wild, the next player draws 6
  | 'wild10'   // Rug Pull: a Wild, the next player draws 10
  | 'roulette'; // Chog Roulette: a Wild, the next player flips until the named colour turns up

/** The table's deck: the official 108, or Chog Chaos's 135. */
export type CardsDeckKind = 'classic' | 'chaos';

export interface Card {
  /** Stable id, 0–107. Hidden cards never reach a client, ids included. */
  id: number;
  kind: CardKind;
  /** null for the Wilds (the colour they name lives on the table, not the card). */
  color: CardColor | null;
  /** 0–9 on number cards only. */
  value?: number;
}

export const COLOR_LABEL: Record<CardColor, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

export const KIND_LABEL: Record<Exclude<CardKind, 'number'>, string> = {
  skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four',
  purge: 'Purge', blitz: 'Blitz', wild6: 'Gas Spike +6', wild10: 'Rug Pull +10', roulette: 'Chog Roulette',
};

/** What each Chog Chaos card does, for the rules and the lobby. */
export const CHAOS_CARD_HELP: { kind: Extract<CardKind, 'purge' | 'blitz' | 'wild6' | 'wild10' | 'roulette'>; help: string }[] = [
  { kind: 'purge', help: 'Every other card of its colour leaves your hand with it.' },
  { kind: 'blitz', help: 'Everyone else is skipped: you go again.' },
  { kind: 'wild6', help: 'A Wild: name the colour, the next player draws 6.' },
  { kind: 'wild10', help: 'A Wild: name the colour, the next player draws 10.' },
  { kind: 'roulette', help: 'A Wild: name the colour, the next player turns up cards until that colour shows, keeps them all and misses their turn.' },
];

export function deckSize(kind: CardsDeckKind = 'classic'): number {
  return kind === 'chaos' ? CARDS_CHAOS_DECK_SIZE : CARDS_DECK_SIZE;
}

/**
 * A deck, always in the same order (ids are positions in it). The official
 * deck, per colour: one 0, two each of 1–9, two Skip, two Reverse, two Draw
 * Two; then four Wild and four Wild Draw Four. Chog Chaos adds, after those
 * (so a Classic card keeps its id): two Purge and two Blitz per colour, then
 * four Gas Spike, three Rug Pull and four Chog Roulette.
 */
export function buildDeck(kind: CardsDeckKind = 'classic'): Card[] {
  const cards: Card[] = [];
  const add = (k: CardKind, color: CardColor | null, value?: number) =>
    cards.push({ id: cards.length, kind: k, color, ...(value !== undefined && { value }) });
  for (const color of CARD_COLORS) {
    add('number', color, 0);
    for (let v = 1; v <= 9; v++) { add('number', color, v); add('number', color, v); }
    for (const k of ['skip', 'reverse', 'draw2'] as const) { add(k, color); add(k, color); }
  }
  for (let i = 0; i < 4; i++) add('wild', null);
  for (let i = 0; i < 4; i++) add('wild4', null);
  if (kind === 'chaos') {
    for (const color of CARD_COLORS) for (const k of ['purge', 'blitz'] as const) { add(k, color); add(k, color); }
    for (let i = 0; i < 4; i++) add('wild6', null);
    for (let i = 0; i < 3; i++) add('wild10', null);
    for (let i = 0; i < 4; i++) add('roulette', null);
  }
  if (cards.length !== deckSize(kind)) throw new Error('deck size');
  return cards;
}

export function isWild(c: Card): boolean {
  return c.color === null;
}

/** Draw cards and what each one adds to a penalty (they stack on each other in this order). */
export const DRAW_VALUE: Partial<Record<CardKind, number>> = { draw2: 2, wild4: 4, wild6: 6, wild10: 10 };
export type DrawKind = 'draw2' | 'wild4' | 'wild6' | 'wild10';

export function isDrawCard(c: Card): c is Card & { kind: DrawKind } {
  return DRAW_VALUE[c.kind] !== undefined;
}

/** What is left in `hand` after playing `c` (a Purge takes the rest of its colour with it). */
export function handAfter(hand: readonly Card[], c: Card): Card[] {
  return hand.filter(x => x.id !== c.id && !(c.kind === 'purge' && x.color === c.color));
}

/** One play from a single card: two cards, or a Purge that would leave one. "Last card!" may be called ahead. */
export function oneAway(hand: readonly Card[]): boolean {
  return hand.length === 2 || hand.some(c => c.kind === 'purge' && handAfter(hand, c).length === 1);
}

/** Points a card left in hand gives the round's winner. */
export function cardPoints(c: Card): number {
  if (c.kind === 'number') return c.value ?? 0;
  if (c.kind === 'wild6' || c.kind === 'wild10' || c.kind === 'roulette') return 60;
  if (c.kind === 'purge' || c.kind === 'blitz') return 30;
  return isWild(c) ? 50 : 20;
}

export function handPoints(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + cardPoints(c), 0);
}

/** "Red 7", "Blue Skip", "Wild Draw Four", "Green Purge", "Rug Pull +10". */
export function cardName(c: Card): string {
  if (c.kind === 'number') return `${COLOR_LABEL[c.color!]} ${c.value}`;
  const k = KIND_LABEL[c.kind];
  return c.color ? `${COLOR_LABEL[c.color]} ${k}` : k;
}

/** Same face: colour and number or symbol (what a jump-in needs). Wilds are never identical for that. */
export function sameFace(a: Card, b: Card): boolean {
  if (isWild(a) || isWild(b)) return false;
  return a.kind === b.kind && a.color === b.color && a.value === b.value;
}

/**
 * The basic matching rule: a Wild always plays; otherwise the colour in play,
 * or the top card's number or symbol. `color` is the colour in play (a Wild's
 * named colour when one is on top).
 */
export function matches(card: Card, top: Card, color: CardColor | null): boolean {
  if (isWild(card)) return true;
  if (color && card.color === color) return true;
  if (isWild(top)) return false;
  if (card.kind === 'number') return top.kind === 'number' && top.value === card.value;
  return card.kind === top.kind;
}

/** The colour a hand holds most of (by count, then by points), for Wild picks. Red for an all-Wild hand. */
export function bestColor(hand: readonly Card[]): CardColor {
  let best: CardColor = 'red', bestN = -1, bestPts = -1;
  for (const color of CARD_COLORS) {
    const mine = hand.filter(c => c.color === color);
    const pts = handPoints(mine);
    if (mine.length > bestN || (mine.length === bestN && pts > bestPts)) {
      best = color; bestN = mine.length; bestPts = pts;
    }
  }
  return best;
}

export function isCardColor(v: unknown): v is CardColor {
  return typeof v === 'string' && (CARD_COLORS as readonly string[]).includes(v);
}
