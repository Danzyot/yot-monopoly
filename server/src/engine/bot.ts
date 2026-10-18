// A simple, decent bot. It also stands in for players who disconnect mid-game
// so one dropped phone can't freeze a table. Pure: reads the game, returns the
// next action (or null when it has nothing to do right now).

import { groupIndices, isOwnable, mortgageValue } from '../../../shared/board.ts';
import { liftCost } from '../../../shared/holdings.ts';
import type { Action } from '../../../shared/types.ts';
import type { Game } from './game.ts';
import { hash } from './minigames/types.ts';

/** Cash a bot likes to keep in hand; more once the board has houses on it (see reserve()). */
const RESERVE = 150;
/** Most a reserve grows to, so a rich bot still develops. */
const MAX_RESERVE = 500;

export function botAction(g: Game, id: string): Action | null {
  if (g.phase === 'over') return null;
  const me = g.player(id);
  if (me.bankrupt) return null;
  const owe = g.debtOf(id);

  // 0. Arcade round: play it (each game's module knows how, and when — bots
  // wait a human-ish moment). Property management is locked until it ends, so
  // the only other useful thing is paying a debt we can already cover.
  if (g.phase === 'minigame') {
    const move = g.minigameBotMove(id);
    if (move) return { type: 'minigame', move };
    return owe > 0 && me.cash >= owe ? { type: 'payDebt' } : null;
  }

  // 1. Debts come first, even out of turn. While an auction runs property is
  // locked, so there is nothing to raise funds with: sit it out (and bid
  // nothing), the debt clock still runs. When even selling everything would
  // not cover it, resign at once rather than strip the estate for nothing.
  if (owe > 0) {
    if (me.cash >= owe) return { type: 'payDebt' };
    if (g.phase !== 'auction') {
      if (liquidValue(g, id) < owe) return { type: 'bankrupt' };
      return raiseFunds(g, id) ?? { type: 'bankrupt' };
    }
  }

  // 2. Auctions.
  const a = g.auction;
  if (g.phase === 'auction' && a) {
    if (!a.bidders.includes(id) || a.highBidder === id) return null;
    const s = g.spaces[a.space];
    const inc = Math.max(5, Math.round((s.price ?? 100) * 0.05));
    const next = a.highBid + inc;
    // Never past the bot's own valuation, nor past what it can pay.
    const cap = Math.min(auctionCeiling(g, id, a.space), me.cash - owe - reserve(g, id));
    if (next <= cap) {
      // Well below the ceiling a bot sometimes jumps by a few increments
      // instead of creeping up one at a time (seeded: the same auction state
      // always gives the same bid).
      const roll = hash('bid', a.space, id, a.highBid);
      const room = Math.floor((cap - next) / inc);
      const jump = room >= 2 && roll % 100 < 35 ? 1 + (roll >>> 8) % Math.min(4, room) : 0;
      return { type: 'bid', amount: next + jump * inc };
    }
    return { type: 'pass' };
  }

  // 3. Trade offers aimed at us.
  for (const t of g.trades) {
    if (t.to !== id) continue;
    // Things moved since it was offered (cash spent, a deed sold on): it cannot go through.
    if (g.tradeProblem(t)) return { type: 'rejectTrade', id: t.id };
    return worthTaking(g, id, t) ? { type: 'acceptTrade', id: t.id } : { type: 'rejectTrade', id: t.id };
  }

  if (g.current.id !== id) return null;

  switch (g.phase) {
    case 'roll':
      if (me.inJail) {
        // Early on, get out and buy things; once the board is bought up and
        // built on, jail is the safest place to sit (rent still comes in).
        if (!stayInJail(g, id)) {
          if (me.jailCards.length) return { type: 'useJailCard' };
          if (me.cash >= g.rules.jailFine + RESERVE) return { type: 'payJail' };
        }
      }
      return develop(g, id) ?? { type: 'roll' };
    case 'buy': {
      const s = g.spaces[me.position];
      const price = s.price ?? 0;
      const completes = completesFor(g, id, me.position);
      // Taking the last lot an opponent needs keeps them from building.
      const blocks = g.active().some(o => o.id !== id && completesFor(g, o.id, me.position));
      const spare = me.cash - price;
      if (spare >= 0 && (spare >= reserve(g, id) || completes || (blocks && spare >= RESERVE / 3))) return { type: 'buy' };
      // Short for a set-completing lot: mortgage odd deeds to afford it.
      if (completes && spare < 0) {
        const odd = mortgageable(g, id).filter(i => !inMySet(g, id, i));
        const raise = odd.reduce((n, i) => n + mortgageValue(g.spaces[i]), 0);
        if (me.cash + raise >= price) return { type: 'mortgage', space: odd[0] };
      }
      return { type: 'decline' };
    }
    case 'choose':
      // Speed Die: the Bus takes the full sum, triples jump to the best free deed.
      return { type: 'choose', value: g.defaultChoice(id) };
    case 'done':
      return develop(g, id) ?? proposeSetTrade(g, id) ?? { type: 'endTurn' };
    default:
      return null;
  }
}

/**
 * The bot's move made safe for an absent human (autopilot): keep the game
 * moving, but never spend their money on a whim or make deals in their name.
 * Null: let the clock run instead (mini-games play safe for them).
 */
export function autopilotAction(g: Game, id: string, action: Action): Action | null {
  switch (action.type) {
    case 'minigame': return null;
    case 'bid': return { type: 'pass' };
    case 'acceptTrade': return { type: 'rejectTrade', id: action.id };
    case 'buy': return { type: 'decline' };
    case 'sell':
    case 'mortgage':
      // Only to raise money owed; never to build or buy with.
      if (g.debtOf(id) > 0) return action;
      break;
    case 'proposeTrade':
    case 'build':
    case 'unmortgage':
      break;
    default:
      return action;
  }
  return g.phase === 'done' ? { type: 'endTurn' } : g.phase === 'buy' ? { type: 'decline' } : { type: 'roll' };
}

/**
 * Rough worth of a space to a player: price, boosted if it builds toward a
 * set. `leaving`: deeds the player hands over in the same deal, which no
 * longer count toward the set.
 */
function valueOf(g: Game, id: string, space: number, leaving: number[] = []): number {
  const s = g.spaces[space];
  let v = s.price ?? 0;
  const keeps = (i: number) => i !== space && g.owned[i]?.owner === id && !leaving.includes(i);
  if (s.kind === 'property' && s.group) {
    const grp = groupIndices(g.spaces, s.group);
    const mine = grp.filter(keeps).length;
    if (mine === grp.length - 1) v *= 1.8;
    else if (mine > 0) v *= 1.25;
  } else if (s.kind === 'railroad' || s.kind === 'utility') {
    const mine = g.ownedBy(id).filter(i => keeps(i) && g.spaces[i].kind === s.kind).length;
    v *= 1 + 0.15 * mine;
  }
  if (g.owned[space]?.mortgaged) v -= mortgageValue(s);
  return Math.round(v);
}

/**
 * How long a computer player thinks before its next move, `base` ms normally.
 * Auction decisions take 1.5-4 s, varied per bot and per bid (seeded by the
 * auction state, so tests stay deterministic) and leaving a human time to bid.
 */
export function botThinkMs(g: Game, id: string, base: number): number {
  const a = g.auction;
  if (g.phase !== 'auction' || !a) return base;
  return Math.max(base, 1500 + hash('think', a.space, id, a.highBid) % 2501);
}

/**
 * The most to bid for `space` at auction: a bargain for a stray lot, close
 * to the printed price for one that builds toward a set, and over it when it
 * completes a set of ours or keeps an opponent from completing theirs.
 */
function auctionCeiling(g: Game, id: string, space: number): number {
  const s = g.spaces[space];
  const price = s.price ?? 0;
  const completes = completesFor(g, id, space);
  const blocks = g.active().some(o => o.id !== id && completesFor(g, o.id, space));
  // A mortgaged deed (a bankrupt's estate) is worth its price less the mortgage to lift.
  const factor = completes || blocks ? 1.1 : valueOf(g, id, space) > price ? 0.95 : 0.8;
  return Math.round(price * factor) - (g.owned[space]?.mortgaged ? mortgageValue(s) : 0);
}

/**
 * Accept when what comes in is clearly worth more than what goes out. Handing
 * someone the last piece of a set costs extra; completing one of our own is
 * worth as much, so a fair set-for-set swap goes through.
 */
function worthTaking(g: Game, id: string, t: { from: string; give: { cash: number; spaces: number[]; jailCards: number }; get: { cash: number; spaces: number[]; jailCards: number } }): boolean {
  const me = g.player(id);
  const price = (i: number) => g.spaces[i].price ?? 0;
  // The 10% due at once on each mortgaged deed received.
  const interest = t.give.spaces.reduce((n, i) => n + (g.owned[i]?.mortgaged ? Math.ceil(mortgageValue(g.spaces[i]) / 10) : 0), 0);
  const completesMine = t.give.spaces.some(i => completesFor(g, id, i, t.get.spaces));
  // Never hand an opponent a monopoly unless the deal completes one of ours
  // too, or they buy it outright at twice the printed price of what we give.
  const completesTheirs = t.get.spaces.some(i => completesFor(g, t.from, i, t.give.spaces));
  if (completesTheirs && !completesMine && t.give.cash < 2 * t.get.spaces.reduce((n, i) => n + price(i), 0)) return false;
  const gain = t.give.cash + t.give.jailCards * 40
    + t.give.spaces.reduce((n, i) => n + valueOf(g, id, i, t.get.spaces) + (completesFor(g, id, i, t.get.spaces) ? price(i) : 0), 0);
  const loss = t.get.cash + t.get.jailCards * 40 + interest
    + t.get.spaces.reduce((n, i) => n + valueOf(g, id, i) + (completesFor(g, t.from, i, t.give.spaces) ? price(i) : 0), 0);
  if (t.get.cash + interest > me.cash - RESERVE) return false;
  return gain >= loss * (completesMine ? 1 : 1.25);
}

/** Cash in hand plus everything that could still be raised (mortgages, buildings at half). */
function liquidValue(g: Game, id: string): number {
  return g.player(id).cash + g.ownedBy(id).reduce((n, i) => {
    const s = g.spaces[i], o = g.owned[i];
    return n + (o.mortgaged ? 0 : mortgageValue(s)) + Math.floor((s.houseCost ?? 0) / 2) * o.houses;
  }, 0);
}

/**
 * How much cash to keep back: enough for a typical bad landing. Grows with
 * the biggest rent an opponent could charge, capped so building still happens.
 */
function reserve(g: Game, id: string): number {
  let worst = 0;
  for (const i of Object.keys(g.owned).map(Number)) {
    const o = g.owned[i];
    if (o.owner === id || o.mortgaged) continue;
    worst = Math.max(worst, g.rentFor(i, {}, 7));
  }
  return Math.min(MAX_RESERVE, Math.max(RESERVE, Math.round(worst / 2)));
}

/** Late game: little left to buy and opponents have built — sit in jail and roll for doubles. */
function stayInJail(g: Game, id: string): boolean {
  // House rule: no rent while in jail — sitting there costs more than it saves.
  if (g.rules.noRentInJail && g.ownedBy(id).some(i => !g.owned[i].mortgaged)) return false;
  const unowned = g.spaces.filter((s, i) => isOwnable(s) && !g.owned[i]).length;
  const danger = Object.values(g.owned).some(o => o.owner !== id && o.houses > 0);
  return unowned <= 4 || (unowned <= 10 && danger);
}

function develop(g: Game, id: string): Action | null {
  const me = g.player(id);
  const mine = g.ownedBy(id);
  const keep = reserve(g, id);
  // Lift mortgages, sets first — a mortgaged set can't be built on.
  const lift = mine
    .filter(i => g.owned[i].mortgaged)
    .sort((a, b) => Number(inMySet(g, id, b)) - Number(inMySet(g, id, a)) || a - b)
    .find(i => me.cash - liftCost(g.spaces, i, g.owned[i]) > keep * 2);
  if (lift !== undefined && g.debtOf(id) === 0) return { type: 'unmortgage', space: lift };
  // Build evenly; three houses is where rent jumps, so every set gets there
  // first, the strongest set leading. When the bank is nearly out of houses,
  // the strongest set gets them whatever its level.
  const shortage = g.rules.limitedBuildings && g.housesLeft <= 3;
  const buildable = mine
    .filter(i => g.canBuild(id, i) === null && me.cash - g.spaces[i].houseCost! >= keep)
    .sort((a, b) => (shortage ? strength(g, b) - strength(g, a) : 0)
      || Math.min(g.owned[a].houses, 3) - Math.min(g.owned[b].houses, 3)
      || strength(g, b) - strength(g, a)
      || g.owned[a].houses - g.owned[b].houses || b - a);
  if (buildable.length) return { type: 'build', space: buildable[0] };
  // Out of houses with a strong set waiting: free one from our weakest
  // built-up set (official housing-shortage play), so the game can move on
  // to hotels instead of stalling with every house spread thin.
  if (g.rules.limitedBuildings && g.housesLeft === 0) {
    const waiting = mine.filter(i => g.canBuild(id, i) === 'The bank is out of houses' && me.cash - g.spaces[i].houseCost! >= keep * 2);
    const best = Math.max(-1, ...waiting.map(i => strength(g, i)));
    const donor = mine
      .filter(i => {
        const o = g.owned[i];
        if (o.houses === 0 || strength(g, i) >= best) return false;
        const lv = groupIndices(g.spaces, g.spaces[i].group!).map(j => g.owned[j].houses);
        return Math.max(...lv) < 5 && o.houses === Math.max(...lv);
      })
      .sort((a, b) => strength(g, a) - strength(g, b) || g.owned[b].houses - g.owned[a].houses)[0];
    if (waiting.length && donor !== undefined) return { type: 'sell', space: donor };
  }
  return null;
}

/** How good a colour set is to build on: its rent at three houses, summed over the set. */
function strength(g: Game, space: number): number {
  const grp = g.spaces[space].group;
  return grp ? groupIndices(g.spaces, grp).reduce((n, i) => n + (g.spaces[i].rent?.[3] ?? 0), 0) : 0;
}

// Which turn each bot last made an offer on, so a rejected offer isn't re-sent
// in a loop. Keyed by game so finished games are collected.
const lastOffer = new WeakMap<Game, Map<string, number>>();

/**
 * Go after the one deed standing between us and a full set: swap it for one
 * that completes a set for its owner (topping up the difference in cash), or
 * else offer cash well over its price.
 */
function proposeSetTrade(g: Game, id: string): Action | null {
  const memo = lastOffer.get(g) ?? new Map<string, number>();
  lastOffer.set(g, memo);
  if (g.turnNumber - (memo.get(id) ?? -Infinity) < g.active().length * 3) return null;
  if (g.trades.some(t => t.from === id)) return null;
  const me = g.player(id);
  const spare = me.cash - reserve(g, id);
  const tradable = (i: number) => {
    const grp = g.spaces[i].group;
    return !grp || groupIndices(g.spaces, grp).every(j => (g.owned[j]?.houses ?? 0) === 0);
  };
  for (const i of Object.keys(g.owned).map(Number)) {
    const o = g.owned[i];
    if (o.owner === id || !completesFor(g, id, i) || !tradable(i)) continue;
    const s = g.spaces[i];
    // A swap: one of ours that completes a set for them.
    const swap = g.ownedBy(id).find(j => tradable(j) && g.spaces[j].group !== s.group && !inMySet(g, id, j)
      && completesFor(g, o.owner, j, [i]));
    if (swap !== undefined) {
      const diff = Math.max(0, s.price! - g.spaces[swap].price!);
      if (diff <= Math.max(0, spare)) {
        memo.set(id, g.turnNumber);
        return {
          type: 'proposeTrade', to: o.owner,
          give: { cash: diff, spaces: [swap], jailCards: 0 },
          get: { cash: 0, spaces: [i], jailCards: 0 },
        };
      }
    }
    const offer = Math.min(Math.round(s.price! * 3), spare);
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

/**
 * Would owning `space` give player `id` the whole colour group? `leaving`:
 * deeds `id` is about to hand over in the same deal, which no longer count.
 */
function completesFor(g: Game, id: string, space: number, leaving: number[] = []): boolean {
  const s = g.spaces[space];
  if (s.kind !== 'property' || !s.group) return false;
  if (g.owned[space]?.owner === id) return false;
  return groupIndices(g.spaces, s.group).every(i => i === space || (g.owned[i]?.owner === id && !leaving.includes(i)));
}

/** Is `space` part of a colour set `id` owns outright? */
function inMySet(g: Game, id: string, space: number): boolean {
  const s = g.spaces[space];
  return s.kind === 'property' && !!s.group && g.ownsGroup(id, s.group);
}

/** Deeds that can be mortgaged right now (no mortgage yet, no buildings in the group). */
function mortgageable(g: Game, id: string): number[] {
  return g.ownedBy(id).filter(i => !g.owned[i].mortgaged && !groupHasHouses(g, i));
}

function raiseFunds(g: Game, id: string): Action | null {
  // Mortgage bare deeds outside our sets (cheapest first) before touching buildings.
  const bare = mortgageable(g, id)
    .sort((a, b) => setScore(g, id, a) - setScore(g, id, b) || (g.spaces[a].price ?? 0) - (g.spaces[b].price ?? 0));
  if (bare.length) return { type: 'mortgage', space: bare[0] };
  // Sell from the most built-up lot, which keeps every group even.
  const withHouses = g.ownedBy(id)
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
