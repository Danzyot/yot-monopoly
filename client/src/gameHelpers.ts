// Small read-only questions the HUD asks about a game: what someone owns, what
// they could build or raise, what a deed earns. The rules themselves live in
// shared/holdings.ts (shared with the engine); this only adds up the numbers.
import { groupIndices, mortgageValue, type SpaceDef } from '../../shared/board.ts';
import { buildProblem, manageProblem } from '../../shared/holdings.ts';
import type { GameView } from '../../shared/types.ts';

/** "lightblue" → "Light blue", "darkBlue" → "Dark blue". */
export function groupLabel(key: string): string {
  if (key === 'railroad') return 'Railroads';
  if (key === 'utility') return 'Utilities';
  const s = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(light|dark)(?=[a-z])/, '$1 ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Board indices `id` owns, in board order. */
export function ownedBy(game: GameView, id: string): number[] {
  return Object.entries(game.owned).filter(([, o]) => o.owner === id).map(([k]) => Number(k)).sort((a, b) => a - b);
}

export function debtOf(game: GameView, id: string): number {
  return game.debts.filter(d => d.from === id).reduce((a, d) => a + d.amount, 0);
}

/** The colour set (or railroads / utilities) a space belongs to. */
export function setKey(s: SpaceDef): string {
  return s.kind === 'property' ? s.group! : s.kind;
}

/** Does `id` own every property of this colour group? */
export function ownsSet(game: GameView, spaces: SpaceDef[], id: string, group: string): boolean {
  const g = groupIndices(spaces, group);
  return g.length > 0 && g.every(i => game.owned[i]?.owner === id);
}

/** Rent a property asks right now (houses, or double for an unbuilt full set). */
export function propertyRent(game: GameView, spaces: SpaceDef[], i: number, houses = game.owned[i]?.houses ?? 0): number {
  const s = spaces[i];
  const o = game.owned[i];
  if (!s.rent || !o) return s.rent?.[0] ?? 0;
  if (houses > 0) return s.rent[houses];
  return ownsSet(game, spaces, o.owner, s.group!) ? s.rent[0] * 2 : s.rent[0];
}

/** Can `id` put a building anywhere right now? (Drives the Build button.) */
export function canBuildAnywhere(game: GameView, spaces: SpaceDef[], id: string): boolean {
  if (game.paused || game.phase === 'over') return false;
  const cash = game.players.find(p => p.id === id)?.cash ?? 0;
  return ownedBy(game, id).some(i => !manageProblem(game, id, i) && !buildProblem(game, spaces, id, i, cash));
}

/** Does `id` hold a complete colour set (built on or not)? */
export function hasFullSet(game: GameView, spaces: SpaceDef[], id: string): boolean {
  const groups = new Set(ownedBy(game, id).map(i => spaces[i]).filter(s => s.kind === 'property').map(s => s.group!));
  return [...groups].some(g => ownsSet(game, spaces, id, g));
}

/**
 * Cash `id` could have by selling every building and mortgaging every deed:
 * the most they can ever pay without help.
 */
export function raisable(game: GameView, spaces: SpaceDef[], id: string): number {
  const p = game.players.find(x => x.id === id);
  let total = p?.cash ?? 0;
  for (const i of ownedBy(game, id)) {
    const s = spaces[i];
    const o = game.owned[i];
    if (o.houses > 0) total += Math.floor((s.houseCost ?? 0) / 2) * o.houses;
    if (!o.mortgaged) total += mortgageValue(s);
  }
  return total;
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suf}`;
}

/** Black or white text, whichever reads better on this background colour. */
export function inkOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#111' : '#fff';
}
