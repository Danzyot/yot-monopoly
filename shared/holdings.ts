// Managing property — building, selling, mortgaging — as pure checks shared
// by the engine (which enforces them) and the deed card (which greys out the
// buttons and says why), so the two can never disagree.
import { groupIndices, unmortgageCost, type SpaceDef } from './board.ts';
import type { RuleConfig } from './themes.ts';
import type { OwnedSpace, TurnPhase } from './types.ts';

/** What the checks need from a game: the engine's Game and a client's GameView both fit. */
export interface Holdings {
  owned: Record<number, OwnedSpace>;
  phase: TurnPhase;
  housesLeft: number;
  hotelsLeft: number;
  rules: Pick<RuleConfig, 'evenBuild' | 'limitedBuildings'>;
}

/** Can `id` touch this deed at all right now? Every management action starts here. */
export function manageProblem(h: Holdings, id: string, space: number): string | null {
  const o = h.owned[space];
  if (!o || o.owner !== id) return 'You do not own that';
  if (h.phase === 'auction') return 'Wait for the auction to finish';
  if (h.phase === 'minigame') return 'Wait for the mini-game to finish';
  return null;
}

/** Why `id` (holding `cash`) cannot build on `space`, or null. Ownership included, the phase not. */
export function buildProblem(h: Holdings, spaces: SpaceDef[], id: string, space: number, cash: number): string | null {
  const s = spaces[space];
  const o = h.owned[space];
  if (!o || o.owner !== id) return 'You do not own that';
  if (s.kind !== 'property') return 'Only coloured properties take houses';
  const grp = groupIndices(spaces, s.group!);
  if (!grp.every(i => h.owned[i]?.owner === id)) return 'You need the whole colour group';
  if (grp.some(i => h.owned[i].mortgaged)) return 'Lift the mortgages in this group first';
  if (o.houses >= 5) return 'Already has a hotel';
  if (h.rules.evenBuild && o.houses > Math.min(...grp.map(i => h.owned[i].houses))) return 'Build evenly across the group';
  if (cash < s.houseCost!) return 'Not enough cash';
  if (h.rules.limitedBuildings) {
    if (o.houses === 4 && h.hotelsLeft === 0) return 'The bank is out of hotels';
    if (o.houses < 4 && h.housesLeft === 0) return 'The bank is out of houses';
  }
  return null;
}

/** Why one building on `space` cannot be sold back, or null (after manageProblem). */
export function sellProblem(h: Holdings, spaces: SpaceDef[], space: number): string | null {
  const o = h.owned[space];
  if (!o || o.houses === 0) return 'Nothing to sell';
  const grp = groupIndices(spaces, spaces[space].group!);
  if (h.rules.evenBuild && o.houses < Math.max(...grp.map(i => h.owned[i]?.houses ?? 0))) return 'Sell evenly across the group';
  return null;
}

/** Why `space` cannot be mortgaged, or null (after manageProblem). */
export function mortgageProblem(h: Holdings, spaces: SpaceDef[], space: number): string | null {
  const o = h.owned[space];
  if (o?.mortgaged) return 'Already mortgaged';
  const group = spaces[space].group;
  if (group && groupIndices(spaces, group).some(i => (h.owned[i]?.houses ?? 0) > 0)) return 'Sell the buildings in this group first';
  return null;
}

/** Why the mortgage on `space` cannot be lifted by someone holding `cash`, or null (after manageProblem). */
export function unmortgageProblem(h: Holdings, spaces: SpaceDef[], space: number, cash: number): string | null {
  if (!h.owned[space]?.mortgaged) return 'Not mortgaged';
  if (cash < unmortgageCost(spaces[space])) return 'Not enough cash';
  return null;
}
