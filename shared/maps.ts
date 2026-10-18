// Maps: the board's structure and economy (how many spaces, which kinds where,
// prices, rents) plus the 3D environment it is played in. Editions are skins on
// top of a map; any edition can be played on any map.

import { CLASSIC_SPACES, type SpaceDef } from './board.ts';
import { CLASSIC_CHANCE, CLASSIC_CHEST, standardDecks, type CardDef } from './cards.ts';
import type { ThemePalette } from './themes.ts';

/** 3D surroundings the board sits in (rendered by the client). */
export type EnvironmentId = 'lounge' | 'speedway' | 'skyline';

/** How the board face is art-directed (client/src/three/boardTexture.ts). */
export type BoardArt = 'heritage' | 'rainbow' | 'night' | 'tptv' | 'chog';

/**
 * A map's own printed look, used when the Original theme is played on it.
 * Branded themes (Chog, Takeprofit TV) bring their own look instead.
 * Set colours were planned in OKLCH: lightness alternates between neighbouring
 * sets so they stay apart for colour-blind players too, and every band also
 * carries a set glyph (see SET_GLYPHS in boardTexture.ts).
 */
export interface MapLook {
  art: BoardArt;
  /** Shown in the lobby next to the theme, e.g. "Rainbow Road". */
  name: string;
  groupColors: Record<string, string>;
  palette: Partial<ThemePalette>;
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  spaces: SpaceDef[];
  chance: CardDef[];
  chest: CardDef[];
  environment: EnvironmentId;
  /** Suggested table size, shown in the lobby. */
  players: [number, number];
  /** Rule defaults this map is designed around (applied when it is picked). */
  startingCash?: number;
  /** The board's own look under the Original theme. */
  look: MapLook;
}

// Heritage: a premium print of the standard board. Cream stock, warm ink,
// rich but slightly desaturated sets (oklch L 0.43–0.88, C 0.08–0.18).
const HERITAGE: MapLook = {
  art: 'heritage',
  name: 'Heritage',
  groupColors: {
    brown: '#7f4730', lightblue: '#8dd0e7', pink: '#b7447e', orange: '#e99541', red: '#c1332f',
    yellow: '#f4d660', green: '#358b53', darkblue: '#204e90', teal: '#3b9d9e', purple: '#6c4494',
  },
  palette: { board: '#f7f0dd', boardLine: '#251e18', boardText: '#251e18', accent: '#ba2b28', rim: '#44241f' },
};

// Rainbow Road: a night-sky face with a neon rainbow track. Sets are neon
// (oklch C 0.11–0.25) and alternate light/dark round the track.
const RAINBOW: MapLook = {
  art: 'rainbow',
  name: 'Rainbow Road',
  groupColors: {
    brown: '#bb7048', lightblue: '#59dff8', pink: '#f72fa7', orange: '#ffa332', red: '#ea1f2f',
    yellow: '#ffea6b', green: '#09c466', darkblue: '#424bef', teal: '#21d1ca', purple: '#a347ef',
  },
  palette: {
    board: '#140f34', boardLine: '#8f86d9', boardText: '#f4f4fe', accent: '#ff4fb2', rim: '#301c64',
    house: '#09c466', hotel: '#ff4fb2',
  },
};

// Night City: deep navy and indigo, gold rules and lettering, neon sets.
const NIGHT: MapLook = {
  art: 'night',
  name: 'Night City',
  groupColors: {
    brown: '#b47548', lightblue: '#7dd4fb', pink: '#eb4b9f', orange: '#fb9f44', teal: '#02b5b2',
    red: '#db2c2f', yellow: '#fcdd5b', purple: '#914ad0', green: '#4fce74', darkblue: '#1e59cd',
  },
  palette: {
    board: '#0d1833', boardLine: '#e9bd63', boardText: '#f6eedc', accent: '#e9bd63', rim: '#a97e2c',
    house: '#4fce74', hotel: '#eb4b9f',
  },
};

// Rents for a price: scale the classic street nearest in price, so new maps
// inherit the classic game's tuned curve instead of invented numbers.
const CLASSIC_PROPS = CLASSIC_SPACES.filter(s => s.kind === 'property');
function rentFor(price: number): number[] {
  const near = CLASSIC_PROPS.reduce((a, b) => (Math.abs(b.price! - price) < Math.abs(a.price! - price) ? b : a));
  const k = price / near.price!;
  return near.rent!.map((r, i) => (i === 0 ? Math.max(2, Math.round(r * k)) : Math.round((r * k) / 5) * 5));
}
function houseCostFor(price: number): number {
  return price <= 120 ? 50 : price <= 200 ? 100 : price <= 280 ? 150 : 200;
}

const P = (name: string, group: string, price: number): SpaceDef =>
  ({ kind: 'property', name, group, price, houseCost: houseCostFor(price), rent: rentFor(price) });
const RR = (name: string): SpaceDef => ({ kind: 'railroad', name, price: 200 });
const UT = (name: string): SpaceDef => ({ kind: 'utility', name, price: 150 });
const TAX = (name: string, tax: number): SpaceDef => ({ kind: 'tax', name, tax });
const CH: SpaceDef = { kind: 'chance', name: 'Chance' };
const CC: SpaceDef = { kind: 'chest', name: 'Community Chest' };
const AR: SpaceDef = { kind: 'arcade', name: 'Arcade' };
const GO: SpaceDef = { kind: 'go', name: 'GO' };
const JAIL: SpaceDef = { kind: 'jail', name: 'Jail' };
const PARK: SpaceDef = { kind: 'parking', name: 'Free Parking' };
const GOJ: SpaceDef = { kind: 'gotojail', name: 'Go To Jail' };

export const CLASSIC_MAP: MapDef = {
  id: 'classic',
  name: 'Classic',
  description: 'The standard 40-space board. The full, familiar game.',
  spaces: CLASSIC_SPACES,
  chance: CLASSIC_CHANCE,
  chest: CLASSIC_CHEST,
  environment: 'lounge',
  players: [2, 6],
  look: HERITAGE,
};

// 32 spaces, every colour set is a pair: sets complete fast, houses go up
// early, and a game fits in a lunch break. Two arcade spaces.
const SPEED_SPACES: SpaceDef[] = [
  GO, P('Pit Lane', 'brown', 60), CC, P('Paddock Row', 'brown', 80), RR('North Station'),
  P('Grid Street', 'lightblue', 100), AR, P('Pole Position', 'lightblue', 120),
  JAIL, P('Chicane Court', 'pink', 140), UT('Fuel Depot'), P('Hairpin Hill', 'pink', 160),
  RR('East Station'), P('Apex Avenue', 'orange', 180), CH, P('Slipstream Way', 'orange', 200),
  PARK, P('Turbo Terrace', 'red', 220), AR, P('Nitro Boulevard', 'red', 240), RR('South Station'),
  P('Podium Plaza', 'yellow', 260), TAX('Speeding Fine', 100), P('Checkered Lane', 'yellow', 280),
  GOJ, P('Victory Lap', 'green', 300), CH, P('Champagne Court', 'green', 320), RR('West Station'),
  P('Trophy Tower', 'darkblue', 350), TAX('Luxury Tax', 150), P('Hall of Fame', 'darkblue', 400),
];

export const SPEED_MAP: MapDef = {
  id: 'speed',
  name: 'Speedway',
  description: '32 spaces, two-street sets, two arcades. Fast games (~30 min).',
  spaces: SPEED_SPACES,
  ...standardDecks(SPEED_SPACES),
  environment: 'speedway',
  players: [2, 5],
  startingCash: 1200,
  look: RAINBOW,
};

// 48 spaces and ten colour sets — room for big tables and long, deal-heavy games.
const METRO_SPACES: SpaceDef[] = [
  GO, P('Harbor Road', 'brown', 60), CC, P('Canal Street', 'brown', 60), P('Mill Lane', 'brown', 80),
  TAX('Income Tax', 200), RR('Central Line'), P('Market Square', 'lightblue', 100), CH,
  P('Bakers Row', 'lightblue', 100), P('Library Walk', 'lightblue', 120), AR,
  JAIL, P('Theatre Lane', 'pink', 140), UT('Power Plant'), P('Gallery Road', 'pink', 140),
  P('Opera Avenue', 'pink', 160), RR('Harbour Line'), P('Garden Street', 'orange', 180), CC,
  P('Park View', 'orange', 180), P('Riverside', 'orange', 200), P('Marina Bay', 'teal', 210),
  P('Lighthouse Point', 'teal', 230),
  PARK, P('Stadium Way', 'red', 220), CH, P('Arena Drive', 'red', 220), P('Coliseum Road', 'red', 240),
  RR('Airport Line'), P('Silicon Street', 'yellow', 260), P('Startup Row', 'yellow', 260),
  UT('Data Center'), P('Unicorn Plaza', 'yellow', 280), P('Embassy Row', 'purple', 290),
  P('Consulate Court', 'purple', 300),
  GOJ, P('Banker Street', 'green', 300), P('Exchange Place', 'green', 300), CC,
  P('Treasury Square', 'green', 320), RR('Express Line'), CH, AR, P('Skyline Heights', 'darkblue', 350),
  TAX('Luxury Tax', 100), P('Penthouse Row', 'darkblue', 380), P('Metropolis Tower', 'darkblue', 400),
];

export const METRO_MAP: MapDef = {
  id: 'metropolis',
  name: 'Metropolis',
  description: '48 spaces, ten colour sets, two arcades. Built for 5–8 players.',
  spaces: METRO_SPACES,
  ...standardDecks(METRO_SPACES),
  environment: 'skyline',
  players: [4, 8],
  startingCash: 1800,
  look: NIGHT,
};

export const MAPS: MapDef[] = [CLASSIC_MAP, SPEED_MAP, METRO_MAP];

export function getMap(id: string): MapDef {
  return MAPS.find(m => m.id === id) ?? CLASSIC_MAP;
}

/** Throws if a map breaks the assumptions the engine and renderer make. */
export function validateMap(m: MapDef): void {
  const n = m.spaces.length;
  if (n < 16 || n % 4 !== 0) throw new Error(`${m.id}: board size ${n} must be a multiple of 4, ≥ 16`);
  const corner = (i: number, kind: string) => {
    if (m.spaces[i].kind !== kind) throw new Error(`${m.id}: space ${i} must be ${kind}`);
  };
  corner(0, 'go'); corner(n / 4, 'jail'); corner(n / 2, 'parking'); corner((3 * n) / 4, 'gotojail');
  m.spaces.forEach((s, i) => {
    if (i % (n / 4) !== 0 && ['go', 'jail', 'parking', 'gotojail'].includes(s.kind)) {
      throw new Error(`${m.id}: ${s.kind} at ${i} must be on a corner`);
    }
    if (s.kind === 'property' && (!s.group || !s.price || s.rent?.length !== 6 || !s.houseCost)) {
      throw new Error(`${m.id}: property ${i} is incomplete`);
    }
  });
  for (const c of [...m.chance, ...m.chest]) {
    if (c.effect.type === 'advance' && !(c.effect.to >= 0 && c.effect.to < n)) {
      throw new Error(`${m.id}: card "${c.text}" targets a space off the board`);
    }
  }
}
