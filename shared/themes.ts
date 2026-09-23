// Editions. Like the poker sites' brand.ts, each custom version is one entry
// here: rename spaces, recolour groups, rewrite cards, restyle the table, and
// tweak default house rules. The engine never branches on theme id.

import { CLASSIC_GROUP_COLORS, type SpaceDef } from './board.ts';
import { cardText, type CardDef } from './cards.ts';
import { getMap } from './maps.ts';

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
  /** Arcade spaces start a mini-game (the site-wide switch must be on too). */
  minigames: boolean;
  /** House rule: Free Parking is an arcade as well (gives Classic mini-games). */
  arcadeParking: boolean;
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
  minigames: true,
  arcadeParking: false,
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
  /** Dice body / pip colours. */
  die?: string;
  pip?: string;
  /** House / hotel colours. */
  house?: string;
  hotel?: string;
}

/** Optional reskin of the HTML interface (lobby + HUD) while this edition is played. */
export interface ThemeUi {
  bg: string;
  panel: string;
  panelSolid: string;
  line: string;
  text: string;
  muted: string;
  /** CSS font-family for the whole UI and the board lettering. */
  font?: string;
}

/** A skin: names, colours, look and default house rules. Works on every map. */
export interface Edition {
  id: string;
  name: string;
  tagline: string;
  /** Printed large in the middle of the board. */
  centerTitle: string;
  currency: string;
  /** Overrides for set colours (a map's extra sets fall back to the defaults). */
  groupColors: Record<string, string>;
  /** Space renames, per map id then space index. */
  mapNames?: Record<string, Record<number, string>>;
  deckNames: { chance: string; chest: string };
  palette: ThemePalette;
  ui?: ThemeUi;
  /** Artwork drawn in the middle of the board and on the edition's cards (path under client/public). */
  logoUrl?: string;
  rules: Partial<RuleConfig>;
}

/** An edition resolved onto a map: everything the engine and renderer need. */
export interface Theme extends Edition {
  mapId: string;
  spaces: SpaceDef[];
  /** Card text already filled in for this board. */
  chance: CardDef[];
  chest: CardDef[];
}

export const CLASSIC: Edition = {
  id: 'classic',
  name: 'Classic',
  tagline: 'The original Atlantic City board.',
  centerTitle: 'MONOPOLY',
  currency: '$',
  groupColors: CLASSIC_GROUP_COLORS,
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

/** Build an edition from another; `names` renames spaces on the Classic map. */
function edition(
  base: Edition,
  over: Partial<Edition> & { id: string; name: string; names?: Record<number, string> },
): Edition {
  const { names, ...rest } = over;
  return {
    ...base,
    ...rest,
    groupColors: { ...base.groupColors, ...over.groupColors },
    mapNames: { ...base.mapNames, ...over.mapNames, ...(names ? { classic: names } : {}) },
    palette: { ...base.palette, ...over.palette },
  };
}

// A worked example of a custom edition. Copy this block for each new version.
export const YOT: Edition = edition(CLASSIC, {
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

// Chog, built from the chog-poker room's design system: purple grounds, Chog
// pink for anything you press, the mascot's cream for the one thing that has
// to be read first, set in Outfit. Values are lifted from that repo's
// client/src/index.css so the two sites read as one brand.
export const CHOG: Edition = edition(CLASSIC, {
  id: 'chog',
  name: 'Chog Edition',
  tagline: 'Chog Poker’s purple room, now as a board. Jackpot on, double on START.',
  centerTitle: 'CHOG',
  currency: '$',
  logoUrl: '/editions/chog/logo.png',
  deckNames: { chance: 'Chog Luck', chest: 'Chog Stash' },
  names: {
    0: 'START', 1: 'Cream Alley', 3: 'Blush Lane', 4: 'Rake', 5: 'Pink Line',
    6: 'Spade Street', 8: 'Club Court', 9: 'Diamond Drive', 10: 'Chog Cage',
    11: 'Flop Plaza', 12: 'Card Shuffler', 13: 'Turn Terrace', 14: 'River Road',
    15: 'Purple Line', 16: 'Blind Boulevard', 18: 'Ante Avenue', 19: 'Button Row',
    20: 'Chog’s Couch', 21: 'Check Street', 23: 'Raise Road', 24: 'All-In Alley',
    25: 'Cream Line', 26: 'Pocket Pairs', 27: 'Full House Row', 28: 'Chip Stacker',
    29: 'Straight Flush', 30: 'Busted!', 31: 'High Roller Heights', 32: 'VIP Lounge',
    34: 'Final Table', 35: 'Magenta Line', 37: 'Chog Tower', 38: 'Buy-In Fee', 39: 'Chog Palace',
  },
  // Eight sets, all pulled toward the brand: tan, cream, pink, amber, red,
  // magenta, blue and the deep purple the felt is cut from.
  groupColors: {
    brown: '#dd9974',
    lightblue: '#56b6ff',
    pink: '#f078a9',
    orange: '#ff9a4d',
    red: '#ff5f57',
    yellow: '#fdf6cd',
    green: '#35c97a',
    darkblue: '#9e3381',
    teal: '#4ad8c7',
    purple: '#6b3fd1',
  },
  palette: {
    sky: '#0a0518',
    table: '#2b1764',
    board: '#1c1140',
    boardLine: '#4a2a9e',
    boardText: '#fdf6cd',
    accent: '#d53f7c',
    die: '#fdf6cd',
    pip: '#902752',
    house: '#d53f7c',
    hotel: '#fdf6cd',
  },
  ui: {
    bg: '#0a0518',
    panel: 'rgba(21, 12, 48, 0.9)',
    panelSolid: '#150c30',
    line: '#2b1a5c',
    text: '#ffffff',
    muted: '#b3a4d6',
    font: "'Outfit', Inter, system-ui, sans-serif",
  },
  rules: { freeParkingPot: true, doubleOnGo: true },
});

export const THEMES: Edition[] = [CLASSIC, CHOG, YOT];

export function getTheme(id: string): Edition {
  return THEMES.find(t => t.id === id) ?? CLASSIC;
}

const resolved = new Map<string, Theme>();

/** An edition on a map: renamed spaces and card text filled in for that board. */
export function resolveTheme(themeId: string, mapId: string): Theme {
  const key = `${themeId}:${mapId}`;
  const hit = resolved.get(key);
  if (hit) return hit;
  const ed = getTheme(themeId);
  const map = getMap(mapId);
  const names = ed.mapNames?.[map.id] ?? {};
  // Generic corner and deck names follow the edition's own vocabulary.
  const spaces = map.spaces.map((s, i) => {
    let name = names[i] ?? s.name;
    if (!names[i] && s.kind === 'chance') name = ed.deckNames.chance;
    if (!names[i] && s.kind === 'chest') name = ed.deckNames.chest;
    return name === s.name ? s : { ...s, name };
  });
  const fill = (cards: CardDef[]) => cards.map(c => ({ ...c, text: cardText(c.text, spaces, ed.currency) }));
  const theme: Theme = {
    ...ed,
    groupColors: { ...CLASSIC_GROUP_COLORS, ...ed.groupColors },
    mapId: map.id,
    spaces,
    chance: fill(map.chance),
    chest: fill(map.chest),
  };
  resolved.set(key, theme);
  return theme;
}
