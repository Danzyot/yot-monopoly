// One token's traits as the home page's Chog of the Day card shows them. The
// server answers GET /api/chogs/:id with this (server/src/routes/chogs.ts),
// so the home page fetches a few hundred bytes instead of the whole trait
// table; the card falls back to loading this module when the server cannot.
import { BACKGROUND_COLORS, traitsOf, type ChogTraits } from './traits.ts';

export interface ChogCard {
  token: number;
  traits: ChogTraits;
  /** The token's background colour (its frame on the card). */
  background: string;
}

export function chogCard(tokenId: number): ChogCard | null {
  const traits = traitsOf(tokenId);
  if (!traits) return null;
  return { token: tokenId, traits, background: (traits.Background && BACKGROUND_COLORS[traits.Background]) || '#eaa2f6' };
}
