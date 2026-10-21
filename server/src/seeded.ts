// Seeded randomness for the Monopoly Daily Challenge (monopolyDaily.ts): the
// same seed gives the same numbers on every table, after every restart.
// SHA-256 rather than a small generator on purpose: a player who sees the
// first rolls must not be able to search the seeds for the one that made
// them, and so learn the rest of the day's dice and cards.
import { createHash } from 'node:crypto';

/** Integers in [0, n) from SHA-256 of `seed` in counter mode. */
export function seededRng(seed: string): (n: number) => number {
  let block = 0;
  let words: number[] = [];
  return (n: number) => {
    if (!words.length) {
      const h = createHash('sha256').update(`${seed}:${block++}`).digest();
      for (let i = 0; i < h.length; i += 4) words.push(h.readUInt32BE(i));
    }
    return Math.floor((words.shift()! / 4294967296) * n);
  };
}

/**
 * Dice that depend on nothing but the seed and the turn: face `k` thrown in
 * turn `turn` (Game's `dice` option). Whatever anyone did before, turn 7's
 * first throw is the same at every table that day.
 */
export function seededDice(seed: string): (turn: number, k: number) => number {
  return (turn, k) => {
    const h = createHash('sha256').update(`${seed}:dice:${turn}:${k}`).digest();
    return Math.floor((h.readUInt32BE(0) / 4294967296) * 6) + 1;
  };
}
