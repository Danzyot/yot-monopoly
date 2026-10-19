// What this page has seen of a game, for the end screen's story: everyone's
// net worth turn by turn (the sparklines, a comeback) and the trades that
// completed a colour set (the deal that decided it). The server keeps only
// totals and the last few log lines, so the page notes these as the game goes,
// per game (GameView.startedAt), in sessionStorage so a reload keeps them.
// Deals come only from the server's record of the last accepted trade
// (lastTrade), never from a deed changing hands, which an operator's move or
// a bankruptcy also does.
// Someone who joined late has a shorter history; the end screen only uses
// what it has enough of.

import { groupIndices, type SpaceDef } from '../../shared/board.ts';
import type { GameView } from '../../shared/types.ts';

export interface WorthPoint { turn: number; worth: Record<string, number> }

/** A trade that handed `to` the last deed of a colour set. */
export interface SetDeal { turn: number; to: string; from: string; group: string }

export interface GameHistory {
  game: number; points: WorthPoint[]; deals: SetDeal[];
  /** The accepted trade (CompletedTrade.id) last looked at: each one is weighed once. */
  trade?: string;
}

/** The server's record of the last accepted trade (server/src/engine/game.ts CompletedTrade; absent from older servers). */
interface CompletedTrade { id: string; turn: number; from: string; to: string; give: number[]; get: number[] }

const KEY = 'yot:history';
const MAX_POINTS = 600;

/**
 * The history of the game on screen, keyed by its id (startedAt). It only
 * mirrors sessionStorage and holds no diff of its own, so a screen that
 * remounts, or a later game, picks up from the record and nothing stale.
 */
let hist: GameHistory | null = null;

function load(game: number): GameHistory {
  if (hist?.game === game) return hist;
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
  // A trade the server says was accepted, weighed once: did it complete a set?
  // Only one seen in the turn it happened, so the owners below are the ones it left.
  const t = (game as GameView & { lastTrade?: CompletedTrade | null }).lastTrade;
  if (t && t.id !== h.trade) {
    h.trade = t.id;
    changed = true;
    if (t.turn === game.turnNumber) {
      for (const [to, from, deeds] of [[t.to, t.from, t.give], [t.from, t.to, t.get]] as const) {
        for (const i of deeds) {
          const group = spaces[i]?.kind === 'property' ? spaces[i].group : undefined;
          if (!group || game.owned[i]?.owner !== to) continue;
          if (!groupIndices(spaces, group).every(j => game.owned[j]?.owner === to)) continue;
          if (h.deals.some(d => d.to === to && d.group === group)) continue;
          h.deals.push({ turn: t.turn, to, from, group });
        }
      }
    }
  }
  if (changed) save(h);
}

/** What this page saw of game `startedAt` (null: nothing). */
export function gameHistory(startedAt: number): GameHistory | null {
  const h = load(startedAt);
  return h.points.length || h.deals.length ? h : null;
}
