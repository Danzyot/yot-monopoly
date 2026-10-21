// Maps: the board's structure and economy (how many spaces, which kinds where,
// prices, rents) plus the 3D environment it is played in. Editions are skins on
// top of a map; any edition can be played on any map.

import { CLASSIC_SPACES, type SpaceDef } from './board.ts';
import { BLITZ_CHANCE, BLITZ_CHEST, CLASSIC_CHANCE, CLASSIC_CHEST, standardDecks, type CardDef } from './cards.ts';
import { loopShape, type Lane, type Shape } from './route.ts';
import type { RuleConfig, ThemePalette } from './themes.ts';

/** 3D surroundings the board sits in (rendered by the client). */
export type EnvironmentId = 'lounge' | 'speedway' | 'skyline' | 'arcade' | 'garden';

/** How the board face is art-directed (client/src/three/boardTexture.ts). */
export type BoardArt = 'heritage' | 'rainbow' | 'night' | 'tptv' | 'chog' | 'pixel' | 'atlas';

/**
 * A map's own printed look, used when the Original theme is played on it.
 * Branded themes (Chog, Takeprofit TV) bring their own look instead.
 * Set colours were planned in OKLCH: lightness alternates between neighbouring
 * sets so they stay apart for colour-blind players too, and every band also
 * carries a set glyph (see SET_GLYPHS in boardTexture.ts).
 */
export interface MapLook {
  art: BoardArt;
  /** The art's name in code and comments, e.g. "Rainbow Road". Players just see
   *  it as the board's Original look, so it is not shown in the UI. */
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
  /** GO salary this map is designed around (applied when it is picked; 200 when absent). */
  goSalary?: number;
  /** Other house rules switched on when the map is picked (Blitz: the jackpot). */
  rules?: Partial<RuleConfig>;
  /** The board's own look under the Original theme. */
  look: MapLook;
  /**
   * A shortcut lane across the board (see shared/route.ts): its spaces are the
   * last `length` in `spaces`, and the loop is the rest. Walking past `from`
   * the player picks the lane or the loop.
   */
  lane?: Lane & { length: number };
  /** Every lap pays more: GO pays `step` more for each salary a player has already collected, up to `max` more. */
  salaryRise?: { step: number; max: number };
  /** Jackpot doubles: rolling double 1s or double 6s scoops the Free Parking pot. */
  jackpotDoubles?: boolean;
  /** How this board plays differently, for How to play (`$` is the edition's currency). */
  special?: string;
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

const P = (name: string, group: string, price: number, houseCost = houseCostFor(price)): SpaceDef =>
  ({ kind: 'property', name, group, price, houseCost, rent: rentFor(price) });
const RR = (name: string, price = 200): SpaceDef => ({ kind: 'railroad', name, price });
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
  // Stated, not left to the default: a table switched here from Speedway must not keep its $1,200.
  startingCash: 1500,
  goSalary: 200,
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
  goSalary: 200,
  look: RAINBOW,
};

// Teal is a two-street set with three-street rents: at the usual $150 a house its owner won half
// of all simulated 4–6 player games; at $200 it sits with Classic's best sets (orange, light blue).
const TEAL_HOUSE = 200;

// 48 spaces and ten colour sets — room for big tables and long, deal-heavy games.
const METRO_SPACES: SpaceDef[] = [
  GO, P('Harbor Road', 'brown', 60), CC, P('Canal Street', 'brown', 60), P('Mill Lane', 'brown', 80),
  TAX('Income Tax', 200), RR('Central Line'), P('Market Square', 'lightblue', 100), CH,
  P('Bakers Row', 'lightblue', 100), P('Library Walk', 'lightblue', 120), AR,
  JAIL, P('Theatre Lane', 'pink', 140), UT('Power Plant'), P('Gallery Road', 'pink', 140),
  P('Opera Avenue', 'pink', 160), RR('Harbour Line'), P('Garden Street', 'orange', 180), CC,
  P('Park View', 'orange', 180), P('Riverside', 'orange', 200), P('Marina Bay', 'teal', 210, TEAL_HOUSE),
  P('Lighthouse Point', 'teal', 230, TEAL_HOUSE),
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
  goSalary: 200,
  look: NIGHT,
};

// Pixel Arcade: an arcade cabinet's attract screen. Black glass, a faint
// pixel grid and scanlines, sets in saturated 8-bit colours that alternate
// light and dark round the short loop.
const PIXEL: MapLook = {
  art: 'pixel',
  name: 'Pixel Arcade',
  groupColors: {
    brown: '#c46a3c', lightblue: '#41e0ff', pink: '#ff4fd8', orange: '#ffa21f', red: '#ff3355',
    yellow: '#ffe14d', green: '#3ce86f', darkblue: '#5b5bff', teal: '#2ee6c8', purple: '#a35bff',
  },
  palette: {
    board: '#07060f', boardLine: '#3b3470', boardText: '#f3f0ff', accent: '#ffe14d', rim: '#1b1640',
    house: '#3ce86f', hotel: '#ff4fd8',
  },
};

// Atlas: a printed road atlas. Pale map paper, contour lines and a compass
// rose, the Express lane printed as a motorway; sets in road-sign colours.
const ATLAS: MapLook = {
  art: 'atlas',
  name: 'Atlas',
  groupColors: {
    brown: '#8a5a3b', lightblue: '#5fb7de', pink: '#d0508f', orange: '#ec8a2e', red: '#cf3a32',
    yellow: '#f0c93c', green: '#2f8f4e', darkblue: '#24508f', teal: '#1f9e97', purple: '#6b47a8',
  },
  palette: { board: '#f2ecd9', boardLine: '#3c4a56', boardText: '#26313a', accent: '#d2492f', rim: '#2f3b45' },
};

/**
 * A street whose rents are the classic curve for its price (rentFor) times
 * `scale[group]`: how a map tunes each set to how often it is landed on.
 */
const scaledStreet = (scale: Record<string, number>) =>
  (name: string, group: string, price: number, houseCost = houseCostFor(price)): SpaceDef => {
    const k = scale[group] ?? 1;
    return {
      ...P(name, group, price, houseCost),
      rent: rentFor(price).map((r, i) => (i === 0 ? Math.max(2, Math.round(r * k)) : Math.round((r * k) / 5) * 5)),
    };
  };

// Blitz: 24 spaces, six two-street sets of cheap streets, four card squares
// and an arcade, so something happens on nearly every roll. Salary starts
// low and rises every lap; double 1s or double 6s scoop the jackpot. Built
// for 2–4 players and a game in about a quarter of an hour.
//
// Rents run above the classic curve so the cheap sets end games quickly; the
// light blues (straight out of jail) less so, the far end of the loop more
// (tuned with the balance sim, 300 games each at 2, 3 and 4 players).
const BZ = scaledStreet({ brown: 1.7, lightblue: 1.05, pink: 1.35, orange: 1.35, red: 1.4, darkblue: 1.75 });
const BLITZ_SPACES: SpaceDef[] = [
  GO, BZ('Pixel Lane', 'brown', 50, 50), CH, BZ('Joystick Row', 'brown', 60, 50), RR('Coin Slot Line', 150), CC,
  JAIL, BZ('High Score Hill', 'lightblue', 90, 50), BZ('Combo Court', 'lightblue', 100, 50), CH,
  BZ('Bonus Round', 'pink', 120, 75), BZ('Power-Up Plaza', 'pink', 140, 75),
  { kind: 'parking', name: 'Jackpot' }, BZ('Turbo Track', 'orange', 160, 100), BZ('Level Up Lane', 'orange', 180, 100), CC,
  BZ('Boss Battle Blvd', 'red', 200, 100), BZ('Extra Life Ave', 'red', 220, 125),
  { kind: 'gotojail', name: 'Game Over' }, RR('Token Line', 150), AR, BZ('Hall of Fame', 'darkblue', 260, 150),
  TAX('Coin-Op Fee', 75), BZ('Grand Prize Palace', 'darkblue', 300, 150),
];

export const BLITZ_MAP: MapDef = {
  id: 'blitz',
  name: 'Blitz',
  description: '24 spaces, cheap two-street sets, a salary that rises every lap and jackpot doubles. Games in ~15 min.',
  spaces: BLITZ_SPACES,
  chance: BLITZ_CHANCE,
  chest: BLITZ_CHEST,
  environment: 'arcade',
  players: [2, 4],
  startingCash: 1000,
  goSalary: 100,
  rules: { freeParkingPot: true },
  salaryRise: { step: 20, max: 120 },
  jackpotDoubles: true,
  special: 'Every lap pays more: GO starts at $100 and pays $20 more each time you collect it, up to $220. '
    + 'Roll double 1s or double 6s and you scoop the Free Parking jackpot, wherever you land.',
  look: PIXEL,
};

// Crossroads: a 48-space loop with an eleven-space Express lane straight
// across the middle, a lap twelve spaces shorter that skips the whole west
// side (jail, Free Parking and four sets). Junction, in the middle of the
// south side, is a set of points: every piece walking past goes the way they
// are set, and whoever stops on Junction throws them, for everyone. (Letting
// each player pick the way as they pass made the lane and the west free to
// dodge: in simulated games their sets were nearly worthless.)
//
// Ten sets for 4–8 players and long, deal-heavy games. Every piece walks the
// east half, so its sets are landed on about twice as often as the west's or
// the lane's: they charge less, the branches' sets more, which evens out
// what each set earns (tuned with the balance sim, 300 games each at 4, 6
// and 8 players).
const XP = scaledStreet({
  brown: 1.3, lightblue: 1.6, pink: 1.55, orange: 1.4, red: 1.65, yellow: 0.83, green: 0.95, darkblue: 0.7, teal: 2, purple: 2.4,
});
const XR_SPACES: SpaceDef[] = [
  // Loop, south side (GO in the south-east corner, Junction in the middle).
  GO, XP('Old Mill Road', 'brown', 60), CC, XP('Tannery Lane', 'brown', 70), TAX('Income Tax', 150), CH,
  RR('Junction'), XP('Orchard Way', 'lightblue', 100), CH, XP('Meadow Lane', 'lightblue', 100),
  XP('Willow Walk', 'lightblue', 120), UT('Waterworks'),
  // West side: the long way round.
  JAIL, XP('Market Street', 'pink', 140), CC, XP('Guild Row', 'pink', 140), XP('Clocktower Square', 'pink', 160), AR,
  RR('West Halt'), XP('Harbour Road', 'orange', 180), CH, XP('Lighthouse Lane', 'orange', 180),
  XP('Ferry Point', 'orange', 200), CC,
  // North side (Terminus in the middle: where the lane comes out).
  PARK, XP('Castle Hill', 'red', 220), CH, XP('Rampart Way', 'red', 220), XP('Kings Gate', 'red', 240), AR,
  RR('Terminus'), XP('University Row', 'yellow', 260), XP('Observatory Road', 'yellow', 260), UT('Power Station'),
  XP('Museum Mile', 'yellow', 280), CC,
  // East side, back to GO.
  GOJ, XP('Embassy Road', 'green', 300), XP('Parliament Street', 'green', 300), CC, XP('Crown Court', 'green', 320),
  CH, RR('East Halt'), CC, XP('Summit Heights', 'darkblue', 350), CH, TAX('Luxury Tax', 100),
  XP('Pinnacle Place', 'darkblue', 400),
  // The Express lane, south to north across the middle.
  XP('Express Way', 'teal', 200), XP('Fast Lane', 'teal', 220), CH, XP('Overpass', 'teal', 240),
  TAX('Toll Booth', 75), AR, XP('Flyover Heights', 'purple', 280), CC, XP('Bypass Boulevard', 'purple', 300),
  XP('Skyway Plaza', 'purple', 320), CH,
];

export const CROSSROADS_MAP: MapDef = {
  id: 'crossroads',
  name: 'Crossroads',
  description: 'A 48-space loop with an Express lane across the middle. Stop on Junction to throw the points for everyone. 4–8 players, long games.',
  spaces: XR_SPACES,
  ...standardDecks(XR_SPACES),
  environment: 'garden',
  players: [4, 8],
  startingCash: 1400,
  goSalary: 150,
  lane: { from: 6, to: 30, length: 11 },
  special: 'An Express lane runs up the middle, a lap twelve squares shorter that skips the west side. '
    + 'The points at Junction send every piece walking past either up the Express or the long way round; '
    + 'stop on Junction and you throw them, for everyone. Everyone walks the east side, so its streets charge less; '
    + 'the Express and the west side charge more.',
  look: ATLAS,
};

export const MAPS: MapDef[] = [CLASSIC_MAP, SPEED_MAP, METRO_MAP, BLITZ_MAP, CROSSROADS_MAP];

export function getMap(id: string): MapDef {
  return MAPS.find(m => m.id === id) ?? CLASSIC_MAP;
}

/** A map's topology: its loop, and the lane across it if it has one (see shared/route.ts). */
export function mapShape(m: MapDef): Shape {
  if (!m.lane) return loopShape(m.spaces.length);
  return { size: m.spaces.length, ring: m.spaces.length - m.lane.length, lane: { from: m.lane.from, to: m.lane.to } };
}

/**
 * The shape of a board from its size alone. Every map has its own number of
 * spaces (validateMaps checks), so code that only knows the size (the
 * renderer's tile maths) still finds the lane.
 */
export function shapeOf(size: number): Shape {
  const m = MAPS.find(x => x.spaces.length === size);
  return m ? mapShape(m) : loopShape(size);
}

/** What GO pays a player who has already collected `laps` salaries (Blitz: more every lap). */
export function salaryFor(m: MapDef, base: number, laps: number): number {
  const r = m.salaryRise;
  return r ? base + Math.min(r.max, r.step * Math.max(0, laps)) : base;
}

/** Throws unless every map is valid and each has its own board size. */
export function validateMaps(maps: MapDef[] = MAPS): void {
  const sizes = maps.map(m => m.spaces.length);
  if (new Set(sizes).size !== sizes.length) throw new Error(`two maps share a board size (${sizes.join(', ')})`);
  for (const m of maps) validateMap(m);
}

/** Throws if a map breaks the assumptions the engine and renderer make. */
export function validateMap(m: MapDef): void {
  const sh = mapShape(m);
  const n = sh.ring;
  if (n < 16 || n % 4 !== 0) throw new Error(`${m.id}: loop size ${n} must be a multiple of 4, ≥ 16`);
  if (m.lane) {
    const { from, to, length } = m.lane;
    // The renderer lays a lane straight across the middle, from the middle of
    // the first side (GO's) to the middle of the third, in tiles the size of
    // the edge's: as many as fit between two corners.
    if ((n / 4) % 2 !== 0 || from !== n / 8 || to !== n / 2 + n / 8) {
      throw new Error(`${m.id}: a lane must cross from the middle of the first side to the middle of the third`);
    }
    if (length !== n / 4 - 1) throw new Error(`${m.id}: a lane must have ${n / 4 - 1} spaces, one per edge tile it spans`);
  }
  const corner = (i: number, kind: string) => {
    if (m.spaces[i].kind !== kind) throw new Error(`${m.id}: space ${i} must be ${kind}`);
  };
  corner(0, 'go'); corner(n / 4, 'jail'); corner(n / 2, 'parking'); corner((3 * n) / 4, 'gotojail');
  m.spaces.forEach((s, i) => {
    if ((i >= n || i % (n / 4) !== 0) && ['go', 'jail', 'parking', 'gotojail'].includes(s.kind)) {
      throw new Error(`${m.id}: ${s.kind} at ${i} must be on a corner`);
    }
    if (s.kind === 'property' && (!s.group || !s.price || s.rent?.length !== 6 || !s.houseCost)) {
      throw new Error(`${m.id}: property ${i} is incomplete`);
    }
  });
  for (const c of [...m.chance, ...m.chest]) {
    if (c.effect.type === 'advance' && !(c.effect.to >= 0 && c.effect.to < sh.size)) {
      throw new Error(`${m.id}: card "${c.text}" targets a space off the board`);
    }
  }
}
