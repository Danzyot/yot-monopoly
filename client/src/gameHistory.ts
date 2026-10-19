// What this page has seen of a game, for the end screen's story: everyone's
// net worth turn by turn (the sparklines, a comeback) and the trades that
// completed a colour set (the deal that decided it). The server keeps only
// totals and the last few log lines, so the page notes these as the game goes,
// per game (GameView.startedAt), in sessionStorage so a reload keeps them.
// Someone who joined late has a shorter history; the end screen only uses
// what it has enough of.

import { groupIndices, type SpaceDef } from '../../shared/board.ts';
import type { GameView } from '../../shared/types.ts';

export interface WorthPoint { turn: number; worth: Record<string, number> }

/** A trade that handed `to` the last deed of a colour set. */
export interface SetDeal { turn: number; to: string; from: string; group: string }

export interface GameHistory { game: number; points: WorthPoint[]; deals: SetDeal[] }

const KEY = 'yot:history';
const MAX_POINTS = 600;

let hist: GameHistory | null = null;
let prevOwned: GameView['owned'] | null = null;

function load(game: number): GameHistory {
  if (hist?.game === game) return hist;
  prevOwned = null;
  try {
    const h = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as GameHistory | null;
    if (h && h.game === game && Array.isArray(h.points) && Array.isArray(h.deals)) return (hist = h);
  } catch { /* storage blocked or junk: start afresh */ }
  return (hist = { game, points: [], deals: [] });
}

function save(h: GameHistory) {
  try { sessionStorage.setItem(KEY, JSON.stringify(h)); } catch { /* private mode, full */ }
}

/** Note what a new view of the game shows. Cheap; call it with every view. */
export function recordHistory(game: GameView, spaces: SpaceDef[]) {
  const h = load(game.startedAt);
  let changed = false;
  const last = h.points.at(-1);
  const worth = Object.fromEntries(game.players.map(p => [p.id, p.bankrupt ? 0 : game.netWorth?.[p.id] ?? p.cash]));
  if (!last || last.turn < game.turnNumber) {
    h.points.push({ turn: game.turnNumber, worth });
    if (h.points.length > MAX_POINTS) h.points.splice(0, h.points.length - MAX_POINTS);
    changed = true;
  } else if (last.turn === game.turnNumber && game.phase === 'over') {
    // The final standing, as the game ended.
    last.worth = worth;
    changed = true;
  }
  // A deed that went from one player still in the game to another is a trade
  // (a bankruptcy hands deeds over too, but its giver is out).
  if (prevOwned) {
    for (const [k, o] of Object.entries(game.owned)) {
      const i = Number(k);
      const was = prevOwned[i];
      if (!was || was.owner === o.owner) continue;
      const giver = game.players.find(p => p.id === was.owner);
      if (!giver || giver.bankrupt) continue;
      const group = spaces[i]?.kind === 'property' ? spaces[i].group : undefined;
      if (!group || !groupIndices(spaces, group).every(j => game.owned[j]?.owner === o.owner)) continue;
      if (h.deals.some(d => d.to === o.owner && d.group === group)) continue;
      h.deals.push({ turn: game.turnNumber, to: o.owner, from: was.owner, group });
      changed = true;
    }
  }
  prevOwned = game.owned;
  if (changed) save(h);
}

/** What this page saw of game `startedAt` (null: nothing). */
export function gameHistory(startedAt: number): GameHistory | null {
  const h = load(startedAt);
  return h.points.length || h.deals.length ? h : null;
}
