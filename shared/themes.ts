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
  /**
   * House rule: taxes, card fines (incl. repairs) and arcade losses go into a
   * pot won by landing on Free Parking. Jail fines, purchases, buildings,
   * mortgages and rent never do.
   */
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
  /** CSS font-family for titles, cash and buttons (defaults to Lilita One). */
  display?: string;
  /** CSS font-family for the board lettering (defaults to `font`). */
  boardFont?: string;
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

// Takeprofit TV, from the takeprofit-tv site's design system: ink-black
// grounds, bone type, amber for anything you press, and the SMPTE colour bars
// as the set colours. Set in Big Shoulders against Space Mono, like the site.
// The railroads are its channels; the board is a broadcast.
export const TPTV: Edition = edition(CLASSIC, {
  id: 'tptv',
  name: 'Takeprofit TV',
  tagline: 'Takeprofit TV, on air. Futures, funded accounts and code TP — now as a board.',
  centerTitle: 'TPTV',
  currency: '$',
  logoUrl: '/editions/tptv/logo.png',
  deckNames: { chance: 'Breaking News', chest: 'Payout' },
  names: {
    0: 'GO LIVE', 1: 'Pre-Market', 3: 'Paper Lane', 4: 'Eval Fee', 5: 'CH 01 Discord',
    6: 'Scalp Street', 8: 'Wick Way', 9: 'Candle Court', 10: 'Off Air',
    11: 'Breakout Blvd', 12: 'Data Feed', 13: 'Support Street', 14: 'Resistance Row',
    15: 'CH 02 YouTube', 16: 'Opening Bell', 18: 'Trend Terrace', 19: 'Momentum Mile',
    20: 'Ad Break', 21: 'ES Futures', 23: 'NQ Futures', 24: 'Gold Futures',
    25: 'CH 03 Code TP', 26: 'Lower Third', 27: 'Prime Time', 28: 'Livestream',
    29: 'Funded Heights', 30: 'Stopped Out!', 31: 'Profit Split', 32: 'Payout Plaza',
    34: 'The Studio', 35: 'CH 04 Live', 37: 'Take Profit Tower', 38: 'Commission', 39: 'TPTV HQ',
  },
  // The test-card bars (75%), nudged brighter where they sit on the dark board.
  groupColors: {
    brown: '#c0c0c0',
    lightblue: '#00c0c0',
    pink: '#c000c0',
    orange: '#ff9e2c',
    red: '#ff3b30',
    yellow: '#c0c000',
    green: '#00c000',
    darkblue: '#3446ff',
    teal: '#5865f2',
    purple: '#8a5cff',
  },
  palette: {
    sky: '#0b0b0d',
    table: '#1a1a20',
    board: '#131317',
    boardLine: '#2e2e36',
    boardText: '#f2f0ea',
    accent: '#ff9e2c',
    die: '#f2f0ea',
    pip: '#0b0b0d',
    house: '#00c000',
    hotel: '#ff3b30',
  },
  ui: {
    bg: '#0b0b0d',
    panel: 'rgba(19, 19, 23, 0.92)',
    panelSolid: '#131317',
    line: '#3a3a44',
    text: '#f2f0ea',
    muted: '#8e8b84',
    font: "'Space Mono', ui-monospace, monospace",
    display: "'Big Shoulders', Impact, sans-serif",
    boardFont: "'Big Shoulders', Impact, sans-serif",
    go: '#ff9e2c',
    goText: '#1a0f00',
  },
  rules: {},
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

export const THEMES: Edition[] = [CLASSIC, TPTV, CHOG];

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
