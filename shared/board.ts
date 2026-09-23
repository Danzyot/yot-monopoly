// The board as data. The engine only ever reads numbers from here (prices,
// rents, groups); names and colours are cosmetic and come from the theme, so a
// custom edition can rename every space without touching game logic.

export type SpaceKind =
  | 'go' | 'property' | 'railroad' | 'utility' | 'tax'
  | 'chance' | 'chest' | 'jail' | 'parking' | 'gotojail';

export interface SpaceDef {
  kind: SpaceKind;
  name: string;
  /** Colour group id for properties ("brown", "lightblue", …). */
  group?: string;
  price?: number;
  /** Property rents: [base, 1 house, 2, 3, 4, hotel]. */
  rent?: number[];
  houseCost?: number;
  /** Flat tax amount. */
  tax?: number;
}

export const BOARD_SIZE = 40;
export const JAIL_INDEX = 10;
export const GO_TO_JAIL_INDEX = 30;

const p = (name: string, group: string, price: number, houseCost: number, rent: number[]): SpaceDef =>
  ({ kind: 'property', name, group, price, houseCost, rent });
const rr = (name: string): SpaceDef => ({ kind: 'railroad', name, price: 200 });
const ut = (name: string): SpaceDef => ({ kind: 'utility', name, price: 150 });

/** Standard US layout and economics. Themes override names/colours/prices. */
export const CLASSIC_SPACES: SpaceDef[] = [
  { kind: 'go', name: 'GO' },
  p('Mediterranean Avenue', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  { kind: 'chest', name: 'Community Chest' },
  p('Baltic Avenue', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  { kind: 'tax', name: 'Income Tax', tax: 200 },
  rr('Reading Railroad'),
  p('Oriental Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  { kind: 'chance', name: 'Chance' },
  p('Vermont Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  p('Connecticut Avenue', 'lightblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  { kind: 'jail', name: 'Jail' },
  p('St. Charles Place', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  ut('Electric Company'),
  p('States Avenue', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  p('Virginia Avenue', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
  rr('Pennsylvania Railroad'),
  p('St. James Place', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  { kind: 'chest', name: 'Community Chest' },
  p('Tennessee Avenue', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  p('New York Avenue', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  { kind: 'parking', name: 'Free Parking' },
  p('Kentucky Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  { kind: 'chance', name: 'Chance' },
  p('Indiana Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  p('Illinois Avenue', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  rr('B. & O. Railroad'),
  p('Atlantic Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  p('Ventnor Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  ut('Water Works'),
  p('Marvin Gardens', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { kind: 'gotojail', name: 'Go To Jail' },
  p('Pacific Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  p('North Carolina Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { kind: 'chest', name: 'Community Chest' },
  p('Pennsylvania Avenue', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  rr('Short Line'),
  { kind: 'chance', name: 'Chance' },
  p('Park Place', 'darkblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { kind: 'tax', name: 'Luxury Tax', tax: 100 },
  p('Boardwalk', 'darkblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

export const CLASSIC_GROUP_COLORS: Record<string, string> = {
  brown: '#8b4a2b',
  lightblue: '#a9dcf5',
  pink: '#d83c96',
  orange: '#f5921e',
  red: '#e1251b',
  yellow: '#fde600',
  green: '#1fb25a',
  darkblue: '#0072bb',
};

export function isOwnable(s: SpaceDef): boolean {
  return s.kind === 'property' || s.kind === 'railroad' || s.kind === 'utility';
}

export function mortgageValue(s: SpaceDef): number {
  return Math.floor((s.price ?? 0) / 2);
}

/** Cost to lift a mortgage: principal plus 10% interest. */
export function unmortgageCost(s: SpaceDef): number {
  return Math.ceil(mortgageValue(s) * 1.1);
}

export function groupIndices(spaces: SpaceDef[], group: string): number[] {
  const out: number[] = [];
  spaces.forEach((s, i) => { if (s.kind === 'property' && s.group === group) out.push(i); });
  return out;
}
