// Which cinematic cutscene a change of game state calls for, and how long it
// runs. Shared so the server (rooms.ts: bots wait for it) and every client
// (client/src/three/cinematics) agree on the moment and the length: one
// cutscene per change, the biggest one wins (a game-ending bankruptcy plays
// BANKRUPT, then WINNER).

export type CutsceneKind = 'winner' | 'bankrupt' | 'jail' | 'jackpot';

/** Full length of each cutscene (ms). Clients on low graphics play a shorter cut; bots wait for this. */
export const CUTSCENE_MS: Record<CutsceneKind, number> = {
  winner: 6000,
  bankrupt: 5300,
  jail: 5900,
  jackpot: 3800,
};

/** Biggest first (a bankruptcy that ends the game plays before the winner's, see pickCutscenes). */
const ORDER: CutsceneKind[] = ['winner', 'bankrupt', 'jail', 'jackpot'];

/** The few things a cutscene is triggered by, copied out of a game (or a GameView). */
export interface CutsceneSnap {
  jailed: string[];
  out: string[];
  pot: number;
  winner: string | null;
  current: string;
}

export interface CutsceneCue {
  kind: CutsceneKind;
  /** Whose moment it is. */
  player: string;
  /** Jackpot: what the pot held. */
  amount?: number;
}

interface Snappable {
  players: readonly { id: string; inJail: boolean; bankrupt: boolean }[];
  pot: number;
  winner: string | null;
  /** A GameView names the current player; the engine holds the player itself. */
  current: string | { id: string };
}

export function cutsceneSnap(g: Snappable): CutsceneSnap {
  return {
    jailed: g.players.filter(p => p.inJail && !p.bankrupt).map(p => p.id),
    out: g.players.filter(p => p.bankrupt).map(p => p.id),
    pot: g.pot,
    winner: g.winner,
    current: typeof g.current === 'string' ? g.current : g.current.id,
  };
}

/**
 * The cutscenes for the change from `a` to `b`, in the order they play: one
 * per change, the biggest, except that a bankruptcy that ends the game plays
 * BANKRUPT first and then WINNER.
 */
export function pickCutscenes(a: CutsceneSnap, b: CutsceneSnap): CutsceneCue[] {
  const found: CutsceneCue[] = [];
  if (b.winner && !a.winner) found.push({ kind: 'winner', player: b.winner });
  const broke = b.out.find(id => !a.out.includes(id));
  if (broke) found.push({ kind: 'bankrupt', player: broke });
  const jailed = b.jailed.find(id => !a.jailed.includes(id));
  if (jailed) found.push({ kind: 'jail', player: jailed });
  // The pot only empties when someone scoops it, on their own move.
  if (a.pot > 0 && b.pot === 0) found.push({ kind: 'jackpot', player: a.current, amount: a.pot });
  found.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const [top, next] = found;
  if (top?.kind === 'winner' && next?.kind === 'bankrupt') return [next, top];
  return top ? [top] : [];
}

/** The first cutscene the change from `a` to `b` plays, or null (see pickCutscenes). */
export function pickCutscene(a: CutsceneSnap, b: CutsceneSnap): CutsceneCue | null {
  return pickCutscenes(a, b)[0] ?? null;
}

/** How long a run of cutscenes plays back to back (full length: what bots wait for). */
export function cutscenesMs(cues: readonly CutsceneCue[]): number {
  return cues.reduce((ms, c) => ms + CUTSCENE_MS[c.kind], 0);
}
