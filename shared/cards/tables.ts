// The card game's settings ("tables"): where a table is played. Each one
// reuses a Monopoly room or set (client/src/three/environments/) and brings a
// felt that suits it; the host picks one in the lobby, like a Monopoly board.

import type { EnvironmentId } from '../maps.ts';

export type CardsTableId = 'lounge' | 'arcade' | 'garden' | 'skyline' | 'classic';

/** The modelled table's colours in a setting (client/src/cards/three/TableFx.tsx). */
export interface CardsTableLook {
  /** The felt's radial gradient: centre, middle, edge. */
  felt: [string, string, string];
  /** The double ring printed near the felt's edge. */
  ring: string;
  /** The table's finish, and the padded rim round the felt. */
  wood: string;
  rim: string;
}

export interface CardsTableDef {
  id: CardsTableId;
  name: string;
  blurb: string;
  /** The Monopoly environment it reuses, and the edition whose room it is (the lounge is one room per edition). */
  environment: EnvironmentId;
  themeId: 'chog' | 'classic' | 'tptv';
  look: CardsTableLook;
}

export const CARDS_TABLES: CardsTableDef[] = [
  {
    id: 'lounge', name: 'Chog Lounge', blurb: 'The purple lounge: pink neon, the bar and the slots.',
    environment: 'lounge', themeId: 'chog',
    look: { felt: ['#7a4ee0', '#4c27a6', '#2a1570'], ring: '#ffd23f', wood: '#2b1764', rim: '#1c0e46' },
  },
  {
    id: 'arcade', name: 'Chog Arcade', blurb: 'A dark hall of glowing machines, the table under its own light.',
    environment: 'arcade', themeId: 'chog',
    look: { felt: ['#2f4fb8', '#1a2a78', '#0d1442'], ring: '#ff6fd8', wood: '#16112e', rim: '#0d0a1c' },
  },
  {
    id: 'garden', name: 'Garden', blurb: 'A summer afternoon in the walled garden, a teal felt on oak.',
    environment: 'garden', themeId: 'chog',
    look: { felt: ['#3fa88e', '#237462', '#154a3e'], ring: '#fff1c9', wood: '#9a6a3c', rim: '#5a3a20' },
  },
  {
    id: 'skyline', name: 'Skyline', blurb: 'The penthouse roof at night: festoon lights, a fire pit, the city below.',
    environment: 'skyline', themeId: 'chog',
    look: { felt: ['#b03a5a', '#7a1f3a', '#4a1024'], ring: '#ffd23f', wood: '#3a2218', rim: '#241410' },
  },
  {
    id: 'classic', name: 'Classic Room', blurb: 'The wood-panelled games room, a fire going and a green baize.',
    environment: 'lounge', themeId: 'classic',
    look: { felt: ['#3f9a52', '#2a6e3a', '#1a4a26'], ring: '#ffd23f', wood: '#5a2a1c', rim: '#2c1810' },
  },
];

export const CARDS_DEFAULT_TABLE: CardsTableId = 'lounge';

export function isCardsTableId(id: unknown): id is CardsTableId {
  return typeof id === 'string' && CARDS_TABLES.some(t => t.id === id);
}

/** The setting with this id; the default for anything else (a room from before settings, a hand-edited snapshot). */
export function getCardsTable(id: unknown): CardsTableDef {
  return CARDS_TABLES.find(t => t.id === id) ?? CARDS_TABLES.find(t => t.id === CARDS_DEFAULT_TABLE)!;
}

/** The lobby's picture of a setting: a 480 × 300 still of the table in it. */
export function cardsTableThumbUrl(id: CardsTableId): string {
  return `/cards/tables/${id}.webp`;
}
