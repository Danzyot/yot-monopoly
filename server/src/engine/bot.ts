// A simple, decent bot. It also stands in for players who disconnect mid-game
// so one dropped phone can't freeze a table. Pure: reads the game, returns the
// next action (or null when it has nothing to do right now).

import { groupIndices, isOwnable, mortgageValue, unmortgageCost } from '../../../shared/board.ts';
import type { Action } from '../../../shared/types.ts';
import type { Game } from './game.ts';

const RESERVE = 150;

export function botAction(g: Game, id: string): Action | null {
  if (g.phase === 'over') return null;
  const me = g.player(id);
  if (me.bankrupt) return null;

  // 1. Debts come first, even out of turn.
  const owe = g.debtOf(id);
  if (owe > 0) {
    if (me.cash >= owe) return { type: 'payDebt' };
    return raiseFunds(g, id) ?? { type: 'bankrupt' };
  }

  // 2. Auctions.
  const a = g.auction;
  if (g.phase === 'auction' && a) {
    if (!a.bidders.includes(id) || a.highBidder === id) return null;
    const s = g.spaces[a.space];
    const value = valueOf(g, id, a.space);
    const next = a.highBid + Math.max(5, Math.round((s.price ?? 100) * 0.05));
    if (next <= value && next <= me.cash - RESERVE / 2) return { type: 'bid', amount: next };
    return { type: 'pass' };
  }

  // 3. Trade offers aimed at us.
  for (const t of g.trades) {
    if (t.to !== id) continue;
    const gain = t.give.cash + t.give.spaces.reduce((s, i) => s + valueOf(g, id, i), 0) + t.give.jailCards * 40;
    // Handing someone the last piece of a set costs more than the deed is worth.
    const loss = t.get.cash + t.get.spaces.reduce((s, i) => s + valueOf(g, id, i) + (completesFor(g, t.from, i) ? g.spaces[i].price! : 0), 0)
      + t.get.jailCards * 40;
    if (gain >= loss * 1.25 && t.get.cash <= me.cash - RESERVE) return { type: 'acceptTrade', id: t.id };
    return { type: 'rejectTrade', id: t.id };
  }

  if (g.current.id !== id) return null;

  switch (g.phase) {
    case 'roll':
      if (me.inJail) {
        if (me.jailCards.length) return { type: 'useJailCard' };
        // Early game, get out and buy things; late game, jail is a safe place to sit.
        const unowned = g.spaces.filter((s, i) => isOwnable(s) && !g.owned[i]).length;
        if (unowned > 8 && me.cash > g.rules.jailFine + RESERVE) return { type: 'payJail' };
      }
      return develop(g, id) ?? { type: 'roll' };
    case 'buy': {
      const s = g.spaces[me.position];
      const price = s.price ?? 0;
      const completes = s.group && groupIndices(g.spaces, s.group).every(i => i === me.position || g.owned[i]?.owner === id);
      if (me.cash >= price && (me.cash - price >= RESERVE || completes)) return { type: 'buy' };
      return { type: 'decline' };
    }
    case 'done':
      return develop(g, id) ?? proposeSetTrade(g, id) ?? { type: 'endTurn' };
    default:
      return null;
  }
}

/** Rough worth of a space to a player: price, boosted if it builds toward a set. */
function valueOf(g: Game, id: string, space: number): number {
  const s = g.spaces[space];
  let v = s.price ?? 0;
  if (s.kind === 'property' && s.group) {
    const grp = groupIndices(g.spaces, s.group);
    const mine = grp.filter(i => g.owned[i]?.owner === id).length;
    if (mine === grp.length - 1) v *= 1.8;
    else if (mine > 0) v *= 1.25;
  }
  if (g.owned[space]?.mortgaged) v -= mortgageValue(s);
  return Math.round(v);
}

function develop(g: Game, id: string): Action | null {
  const me = g.player(id);
  const mine = g.ownedBy(id);
  // Lift mortgages on sets first — a mortgaged set can't be built on.
  for (const i of mine) {
    const o = g.owned[i];
    if (o.mortgaged && me.cash - unmortgageCost(g.spaces[i]) > RESERVE * 2) return { type: 'unmortgage', space: i };
  }
  const buildable = mine
    .filter(i => g.canBuild(id, i) === null && me.cash - g.spaces[i].houseCost! >= RESERVE)
    .sort((a, b) => g.owned[a].houses - g.owned[b].houses || b - a);
  if (buildable.length) return { type: 'build', space: buildable[0] };
  return null;
}

// Which turn each bot last made an offer on, so a rejected offer isn't re-sent
// in a loop. Keyed by game so finished games are collected.
const lastOffer = new WeakMap<Game, Map<string, number>>();

/** Offer cash for the one property standing between us and a full set. */
function proposeSetTrade(g: Game, id: string): Action | null {
  const memo = lastOffer.get(g) ?? new Map<string, number>();
  lastOffer.set(g, memo);
  if (g.turnNumber - (memo.get(id) ?? -Infinity) < g.active().length * 3) return null;
  if (g.trades.some(t => t.from === id)) return null;
  const me = g.player(id);
  for (const i of Object.keys(g.owned).map(Number)) {
    const o = g.owned[i];
    if (o.owner === id || !completesFor(g, id, i)) continue;
    const s = g.spaces[i];
    if (groupIndices(g.spaces, s.group!).some(j => g.owned[j].houses > 0)) continue;
    const offer = Math.min(Math.round(s.price! * 3), me.cash - RESERVE);
    if (offer < s.price! * 2) continue;
    memo.set(id, g.turnNumber);
    return {
      type: 'proposeTrade', to: o.owner,
      give: { cash: offer, spaces: [], jailCards: 0 },
      get: { cash: 0, spaces: [i], jailCards: 0 },
    };
  }
  return null;
}

/** Would owning `space` give player `id` the whole colour group? */
function completesFor(g: Game, id: string, space: number): boolean {
  const s = g.spaces[space];
  if (s.kind !== 'property' || !s.group) return false;
  return groupIndices(g.spaces, s.group).every(i => i === space || g.owned[i]?.owner === id);
}

function raiseFunds(g: Game, id: string): Action | null {
  const mine = g.ownedBy(id);
  // Mortgage bare, non-set property before touching buildings.
  const bare = mine
    .filter(i => !g.owned[i].mortgaged && !groupHasHouses(g, i))
    .sort((a, b) => setScore(g, id, a) - setScore(g, id, b));
  if (bare.length) return { type: 'mortgage', space: bare[0] };
  const withHouses = mine
    .filter(i => g.owned[i].houses > 0)
    .sort((a, b) => g.owned[b].houses - g.owned[a].houses);
  if (withHouses.length) return { type: 'sell', space: withHouses[0] };
  return null;
}

function groupHasHouses(g: Game, i: number): boolean {
  const grp = g.spaces[i].group;
  return !!grp && groupIndices(g.spaces, grp).some(j => (g.owned[j]?.houses ?? 0) > 0);
}

function setScore(g: Game, id: string, i: number): number {
  const s = g.spaces[i];
  if (s.kind !== 'property') return 1;
  return g.ownsGroup(id, s.group!) ? 3 : 0;
}
