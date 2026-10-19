// The 108-card deck and the pure card rules both sides need: what matches,
// what a card is worth, what it is called. Every physical card has a stable
// id (0–107) so the server can prove none is ever lost or duplicated and the
// client can animate one card from pile to hand to table.

import { CARDS_DECK_SIZE } from './meta.ts';

export const CARD_COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  /** Stable id, 0–107. Hidden cards never reach a client, ids included. */
  id: number;
  kind: CardKind;
  /** null for Wild and Wild Draw Four (the colour they name lives on the table, not the card). */
  color: CardColor | null;
  /** 0–9 on number cards only. */
  value?: number;
}

export const COLOR_LABEL: Record<CardColor, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

const KIND_LABEL: Record<Exclude<CardKind, 'number'>, string> = {
  skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four',
};

/**
 * The official deck, always in the same order (ids are positions in it). Per
 * colour: one 0, two each of 1–9, two Skip, two Reverse, two Draw Two; then
 * four Wild and four Wild Draw Four.
 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  const add = (kind: CardKind, color: CardColor | null, value?: number) =>
    cards.push({ id: cards.length, kind, color, ...(value !== undefined && { value }) });
  for (const color of CARD_COLORS) {
    add('number', color, 0);
    for (let v = 1; v <= 9; v++) { add('number', color, v); add('number', color, v); }
    for (const kind of ['skip', 'reverse', 'draw2'] as const) { add(kind, color); add(kind, color); }
  }
  for (let i = 0; i < 4; i++) add('wild', null);
  for (let i = 0; i < 4; i++) add('wild4', null);
  if (cards.length !== CARDS_DECK_SIZE) throw new Error('deck size');
  return cards;
}

export function isWild(c: Card): boolean {
  return c.kind === 'wild' || c.kind === 'wild4';
}

/** Points a card left in hand gives the round's winner. */
export function cardPoints(c: Card): number {
  if (c.kind === 'number') return c.value ?? 0;
  return isWild(c) ? 50 : 20;
}

export function handPoints(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + cardPoints(c), 0);
}

/** "Red 7", "Blue Skip", "Wild Draw Four". */
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
