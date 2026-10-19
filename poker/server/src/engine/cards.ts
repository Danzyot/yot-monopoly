import { randomInt } from 'node:crypto';
import type { CardT, Suit } from '../../../shared/types.ts';

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const SUITS: Suit[] = [0, 1, 2, 3];

export function freshDeck(): CardT[] {
  const deck: CardT[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

// Fisher-Yates with crypto-grade randomness.
export function shuffledDeck(): CardT[] {
  const deck = freshDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const RANK_CHARS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_CHARS = ['s', 'h', 'd', 'c'];

export function cardStr(c: CardT): string {
  return RANK_CHARS[c.r] + SUIT_CHARS[c.s];
}

export function parseCard(s: string): CardT {
  const rc = s[0].toUpperCase();
  const r = Object.entries(RANK_CHARS).find(([, v]) => v === rc)?.[0];
  const suit = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (!r || suit < 0) throw new Error(`bad card: ${s}`);
  return { r: Number(r), s: suit as Suit };
}

export function parseCards(s: string): CardT[] {
  return s.trim().split(/\s+/).map(parseCard);
}
