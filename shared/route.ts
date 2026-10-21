// Board topology: where a piece can step from each space. Most boards are a
// single loop (space i leads to i + 1, the last space back to GO). A board
// with a lane (MapDef.lane) also has a fork, Junction: from there a piece
// either turns off into the lane, whose spaces are listed last in the map and
// which comes back out further round the loop, or carries on round the loop.
// Which way is the points' call (GameView.points). Pure functions over a
// Shape, shared by the engine (moves, cards), the bots and the client
// (walking the pieces), so they always agree on a route.

/** A shortcut lane across the board, one way, from a loop space to another. */
export interface Lane {
  /** Loop space the lane turns off from (the fork). */
  from: number;
  /** Loop space the lane comes out on: its last space steps onto this one. */
  to: number;
}

export interface Shape {
  /** Every space on the board. */
  size: number;
  /** Spaces on the loop, 0..ring-1 (GO first, a corner every ring / 4); lane spaces follow. */
  ring: number;
  lane: Lane | null;
}

/** A plain loop of `n` spaces. */
export function loopShape(n: number): Shape {
  return { size: n, ring: n, lane: null };
}

export function onLane(sh: Shape, i: number): boolean {
  return i >= sh.ring;
}

/** Is `i` the fork (Junction), where the points send a piece into the lane or on round the loop? */
export function isFork(sh: Shape, i: number): boolean {
  return !!sh.lane && i === sh.lane.from;
}

/** Where a piece on `i` steps next; at the fork, `lane` picks the lane. */
export function stepFrom(sh: Shape, i: number, lane = false): number {
  const { ring, size } = sh;
  if (sh.lane) {
    if (i >= ring) return i + 1 < size ? i + 1 : sh.lane.to;
    if (i === sh.lane.from && lane) return ring;
  }
  return (i + 1) % ring;
}

/** The space behind `i` ("go back" cards): along the lane back to the fork, else the loop space before. */
export function stepBack(sh: Shape, i: number): number {
  if (sh.lane && i >= sh.ring) return i === sh.ring ? sh.lane.from : i - 1;
  return (i - 1 + sh.ring) % sh.ring;
}

/**
 * Walk `steps` spaces from `from` (negative: backwards). `lane` says which
 * way to go at the fork. Returns the spaces stepped on, in order (not `from`).
 */
export function walk(sh: Shape, from: number, steps: number, lane = false): number[] {
  const out: number[] = [];
  let i = from;
  for (let k = 0; k < Math.abs(steps); k++) {
    i = steps > 0 ? stepFrom(sh, i, lane) : stepBack(sh, i);
    out.push(i);
  }
  return out;
}

/** Every space ahead of `from`, nearest first, each once, with how many steps away it is. */
export function ahead(sh: Shape, from: number): { i: number; d: number }[] {
  const dist = new Map<number, number>([[from, 0]]);
  const order: { i: number; d: number }[] = [];
  let frontier = [from];
  for (let d = 1; frontier.length && order.length < sh.size; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const opts = isFork(sh, i) ? [stepFrom(sh, i, true), stepFrom(sh, i)] : [stepFrom(sh, i)];
      for (const j of opts) {
        if (dist.has(j)) continue;
        dist.set(j, d);
        order.push({ i: j, d });
        next.push(j);
      }
    }
    frontier = next;
  }
  return order;
}

/**
 * The shortest way forward from `from` to `to`, the spaces stepped on in
 * order (ending on `to`). `to === from` is a full lap, the short way round.
 */
export function routeTo(sh: Shape, from: number, to: number): number[] {
  const prev = new Map<number, number>();
  let frontier = [from];
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const opts = isFork(sh, i) ? [stepFrom(sh, i, true), stepFrom(sh, i)] : [stepFrom(sh, i)];
      for (const j of opts) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        if (j === to) {
          const path = [to];
          for (let k = prev.get(to)!; k !== from; k = prev.get(k)!) path.unshift(k);
          return path;
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return [];
}

/**
 * The spaces a recorded walk stepped on: `steps` from `from`, ending on `to`
 * (at the fork, whichever way gets there; the loop when both or neither do).
 */
export function legRoute(sh: Shape, from: number, steps: number, to: number): number[] {
  const loop = walk(sh, from, steps, false);
  if (!sh.lane || steps <= 0 || loop.at(-1) === to) return loop;
  const lane = walk(sh, from, steps, true);
  return lane.at(-1) === to ? lane : loop;
}

/** Did a route pass over (or stop on) GO? */
export function passesGo(route: number[]): boolean {
  return route.includes(0);
}

/** The spaces of one way between the fork and where the ways meet again (the lane, or the loop's detour). */
export function branch(sh: Shape, lane: boolean): number[] {
  if (!sh.lane) return [];
  const way = walk(sh, sh.lane.from, sh.size, lane);
  return way.slice(0, way.indexOf(sh.lane.to));
}
