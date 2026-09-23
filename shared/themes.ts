// Editions. Like the poker sites' brand.ts, each custom version is one entry
// here: rename spaces, recolour groups, rewrite cards, restyle the table, and
// tweak default house rules. The engine never branches on theme id.

import { CLASSIC_GROUP_COLORS, CLASSIC_SPACES, type SpaceDef } from './board.ts';
import { CLASSIC_CHANCE, CLASSIC_CHEST, type CardDef } from './cards.ts';

export interface RuleConfig {
  startingCash: number;
  goSalary: number;
  /** House rule: landing exactly on GO pays double. */
  doubleOnGo: boolean;
  /** House rule: taxes and card fines go into a pot won by landing on Free Parking. */
  freeParkingPot: boolean;
  /** Unbought properties go to auction (official rule). */
  auctions: boolean;
  /** Build evenly across a colour group (official rule). */
  evenBuild: boolean;
  /** Bank has a finite supply of houses/hotels (32 / 12). */
  limitedBuildings: boolean;
  jailFine: number;
  maxPlayers: number;
}

export const DEFAULT_RULES: RuleConfig = {
  startingCash: 1500,
  goSalary: 200,
  doubleOnGo: false,
  freeParkingPot: false,
  auctions: true,
  evenBuild: true,
  limitedBuildings: true,
  jailFine: 50,
  maxPlayers: 6,
};

export interface ThemePalette {
  /** Scene background / fog. */
  sky: string;
  /** Table the board sits on. */
  table: string;
  /** Board face base colour. */
  board: string;
  /** Board border + tile outlines. */
  boardLine: string;
  /** Text printed on the board. */
  boardText: string;
  /** UI accent. */
  accent: string;
}

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  /** Printed large in the middle of the board. */
  centerTitle: string;
  currency: string;
  spaces: SpaceDef[];
  groupColors: Record<string, string>;
  chance: CardDef[];
  chest: CardDef[];
  deckNames: { chance: string; chest: string };
  palette: ThemePalette;
  rules: Partial<RuleConfig>;
}

export const CLASSIC: Theme = {
  id: 'classic',
  name: 'Classic',
  tagline: 'The original Atlantic City board.',
  centerTitle: 'MONOPOLY',
  currency: '$',
  spaces: CLASSIC_SPACES,
  groupColors: CLASSIC_GROUP_COLORS,
  chance: CLASSIC_CHANCE,
  chest: CLASSIC_CHEST,
  deckNames: { chance: 'Chance', chest: 'Community Chest' },
  palette: {
    sky: '#1b2330',
    table: '#3a2718',
    board: '#cde6d0',
    boardLine: '#1a1a1a',
    boardText: '#111111',
    accent: '#e1251b',
  },
  rules: {},
};

/** Build a theme from Classic by renaming spaces; anything else can be overridden too. */
function edition(
  base: Theme,
  over: Omit<Partial<Theme>, 'spaces'> & { id: string; name: string; names?: Record<number, string> },
): Theme {
  const { names, ...rest } = over;
  const spaces = base.spaces.map((s, i) => (names?.[i] ? { ...s, name: names[i] } : s));
  return { ...base, ...rest, spaces, palette: { ...base.palette, ...over.palette } };
}

// A worked example of a custom edition. Copy this block for each new version.
export const YOT: Theme = edition(CLASSIC, {
  id: 'yot',
  name: 'Yot City',
  tagline: 'Neon edition — night mode, free-parking jackpot on.',
  centerTitle: 'YOT CITY',
  currency: '¥',
  deckNames: { chance: 'Glitch', chest: 'Stash' },
  names: {
    0: 'START', 1: 'Dockside Row', 3: 'Rust Lane', 4: 'Server Fees', 5: 'Metro Line A',
    6: 'Pixel Park', 8: 'Arcade Alley', 9: 'Byte Street', 10: 'Lockup',
    11: 'Synth Square', 12: 'Power Grid', 13: 'Chrome Court', 14: 'Laser Way',
    15: 'Metro Line B', 16: 'Neon Market', 18: 'Holo Heights', 19: 'Vapor Avenue',
    20: 'Chill Zone', 21: 'Crimson Strip', 23: 'Ember Boulevard', 24: 'Blaze Plaza',
    25: 'Metro Line C', 26: 'Gold Terrace', 27: 'Sunset Drive', 28: 'Cloud Storage',
    29: 'Solar Gardens', 30: 'Busted!', 31: 'Jade Tower', 32: 'Emerald Row',
    34: 'Matrix Quarter', 35: 'Metro Line D', 37: 'Sky Deck', 38: 'Gas Fees', 39: 'Yot Tower',
  },
  groupColors: {
    brown: '#7a4cff',
    lightblue: '#28e0ff',
    pink: '#ff3ec8',
    orange: '#ff8a1f',
    red: '#ff2e55',
    yellow: '#ffe53b',
    green: '#35ff8f',
    darkblue: '#3b6dff',
  },
  palette: {
    sky: '#07040f',
    table: '#120b24',
    board: '#191233',
    boardLine: '#7d5cff',
    boardText: '#f3ecff',
    accent: '#ff3ec8',
  },
  rules: { freeParkingPot: true },
});

export const THEMES: Theme[] = [CLASSIC, YOT];

export function getTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? CLASSIC;
}
