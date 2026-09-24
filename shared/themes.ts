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
  /** Seconds a (human) player has for each step of their turn; 0 = no timer. */
  turnSeconds: number;
  /** Game length in minutes; when it runs out the richest player wins. 0 = no limit. */
  timeLimitMin: number;
  /** House rule: owners sitting in jail collect no rent. */
  noRentInJail: boolean;
  /** Official variant: a third Speed Die once a player has passed GO. */
  speedDie: boolean;
}

/** Choices the lobby offers; the server accepts any value in range (see sanitizeRules). */
export const TURN_SECONDS_CHOICES = [0, 30, 60, 90, 120];
export const TIME_LIMIT_CHOICES = [0, 30, 45, 60, 90];

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
  turnSeconds: 90,
  timeLimitMin: 0,
  noRentInJail: false,
  speedDie: false,
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
  /** Colour of the main (GO / Buy / Start) buttons; defaults to Monopoly GO green. */
  go?: string;
  /** Text colour on those buttons when the colour is light. */
  goText?: string;
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

// WAWA, from the wawa-poker room: near-black navy grounds, trading-desk gold
// for anything you press, the green felt as the table. Spaces are named after
// the prop-firm grind the community lives on.
export const WAWA: Edition = edition(CLASSIC, {
  id: 'wawa',
  name: 'WAWA Edition',
  tagline: 'The WAWA trading floor. Get funded, dodge the drawdown, cash the payout.',
  centerTitle: 'WAWA',
  currency: '$',
  deckNames: { chance: 'Market Open', chest: 'Payout' },
  names: {
    0: 'START', 1: 'Demo Account', 3: 'Paper Lane', 4: 'Eval Fee', 5: 'NY Session',
    6: 'Scalp Street', 8: 'Wick Way', 9: 'Candle Court', 10: 'Blown Account',
    11: 'Breakout Blvd', 12: 'Data Feed', 13: 'Support Street', 14: 'Resistance Row',
    15: 'London Session', 16: 'Swing Square', 18: 'Trend Terrace', 19: 'Momentum Mile',
    20: 'Market Closed', 21: 'Futures Field', 23: 'Leverage Lane', 24: 'Margin Plaza',
    25: 'Asia Session', 26: 'Challenge Ave', 27: 'Phase Two', 28: 'Copy Trader',
    29: 'Funded Heights', 30: 'Drawdown!', 31: 'Profit Split', 32: 'Payout Plaza',
    34: 'Scaling Plan', 35: 'Overnight Session', 37: 'Prop Firm Tower', 38: 'Commission', 39: 'WAWA HQ',
  },
  groupColors: {
    brown: '#b07a48',
    lightblue: '#5ab4f0',
    pink: '#e87aa8',
    orange: '#f0913a',
    red: '#e5544f',
    yellow: '#ecc372',
    green: '#35c96f',
    darkblue: '#3f6fd8',
  },
  palette: {
    sky: '#0b0e14',
    table: '#143f2c',
    board: '#f4ecd6',
    boardLine: '#1c2330',
    boardText: '#151a24',
    accent: '#d9a441',
    die: '#f4ecd6',
    pip: '#151a24',
    house: '#35c96f',
    hotel: '#d9a441',
  },
  ui: {
    bg: '#0b0e14',
    panel: 'rgba(21, 26, 36, 0.92)',
    panelSolid: '#151a24',
    line: '#3a4a66',
    text: '#e9edf4',
    muted: '#9aa5b8',
    go: '#e8b64c',
    goText: '#2a1c04',
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
    line: '#4a2a9e',
    text: '#ffffff',
    muted: '#b3a4d6',
    font: "'Outfit', Inter, system-ui, sans-serif",
    go: '#d53f7c',
  },
  rules: { freeParkingPot: true, doubleOnGo: true },
});

export const THEMES: Edition[] = [CLASSIC, WAWA, CHOG];

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
