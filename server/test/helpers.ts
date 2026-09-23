import { Game } from '../src/engine/game.ts';
import { CLASSIC, DEFAULT_RULES, type RuleConfig } from '../../shared/themes.ts';

/** A game whose dice are scripted: push faces with roll(). */
export function scripted(n = 2, rules: Partial<RuleConfig> = {}) {
  const queue: number[] = [];
  let clock = 1_000_000;
  const g = new Game({
    theme: CLASSIC,
    rules: { ...DEFAULT_RULES, ...rules },
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, token: 'car' as const, color: '#fff', isBot: false,
    })),
    rng: k => (queue.length ? queue.shift()! % k : 0),
    now: () => clock,
  });
  return {
    g,
    /** Queue the next two dice faces. */
    dice(a: number, b: number) { queue.push(a - 1, b - 1); },
    tick(ms: number) { clock += ms; },
    act(id: string, a: Parameters<Game['apply']>[1]) { g.apply(id, a); },
  };
}

/** Seeded PRNG (mulberry32). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}
