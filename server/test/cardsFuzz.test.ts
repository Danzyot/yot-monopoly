// 500 seeded games with 2–10 players and random house rules. Bots race each
// other the way a room would run them (each acts after its think time, the
// soonest goes first, so catches, late calls and jump-ins really happen).
// Some seats are "humans" who sometimes idle (timeouts, autopilot), a few
// leave mid-game, and garbage actions are thrown in. After every step: all
// 108 cards are present exactly once, hands are sane, no view leaks a hidden
// card, and every game ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardsError, CardsGame } from '../src/cards/game.ts';
import { cardsAutopilotAction, cardsBotAction, cardsBotThinkMs } from '../src/cards/bot.ts';
import { CARDS_DECK_SIZE } from '../../shared/cards/meta.ts';
import type { CardsRules } from '../../shared/cards/rules.ts';
import type { CardsAction, CardsBotLevel, CardsPhase, CardsView } from '../../shared/cards/types.ts';
import { assertConserved, assertRefused, seeded } from './cardsHelpers.ts';

const GAMES = 500;
const STEP_CAP = 20_000;
const PHASES: CardsPhase[] = ['play', 'drawn', 'color', 'swap', 'roundOver', 'over'];
const LEVELS: CardsBotLevel[] = ['easy', 'normal', 'hard'];
const JUNK: unknown[] = [
  null, 42, 'play', {}, { type: 'nonsense' }, { type: 'play' }, { type: 'play', card: -1 }, { type: 'play', card: 1.5 },
  { type: 'play', card: '3' }, { type: 'play', card: 999 }, { type: 'chooseColor', color: 'purple' },
  { type: 'swap', target: 'nobody' }, { type: 'catch', target: 'x'.repeat(100) }, { type: 'catch', target: null },
  { type: '__proto__' }, { type: 'constructor' },
];

function checkInvariants(g: CardsGame, where: string) {
  assertConserved(g, where);
  assert.ok(PHASES.includes(g.phase), `bad phase ${g.phase} (${where})`);
  assert.ok(g.top, `no card on the table (${where})`);
  for (const p of g.players) {
    assert.ok(p.hand.length >= 0, `negative hand (${where})`);
    if (p.left) assert.equal(p.hand.length, 0, `a player who left holds cards (${where})`);
    assert.ok(Number.isSafeInteger(p.score) && p.score >= 0, `bad score (${where})`);
  }
  if (g.phase === 'over') {
    assert.ok(g.winner, `over without a winner (${where})`);
    return;
  }
  if (g.phase === 'roundOver') return;
  assert.ok(!g.current.left, `current player has left (${where})`);
  if (g.phase !== 'color') assert.ok(g.color, `no colour in play (${where})`);
  if (g.phase === 'drawn') assert.ok(g.current.hand.some(c => c.id === g.drawnCard), `drawn card not in hand (${where})`);
  if (g.pending) assert.ok(g.pending.amount >= 2, `empty penalty (${where})`);
  // Round still running: nobody has gone out yet.
  for (const p of g.active()) assert.ok(p.hand.length > 0, `empty hand mid-round (${where})`);
}

/**
 * Every card anywhere in a view must be one this viewer may see: their own
 * hand, the face-up discards, cards played or turned up in the last play, a
 * draw of their own, or a hand they challenged.
 */
function checkNoLeak(g: CardsGame, v: CardsView, viewer: string | undefined, where: string) {
  const own = viewer ? g.players.find(p => p.id === viewer)?.hand ?? [] : [];
  const visible = new Set<number>([...own, ...g.discard].map(c => c.id));
  for (const s of g.lastPlay?.steps ?? []) {
    if (s.type === 'play' || s.type === 'flip') visible.add(s.card.id);
    if (s.type === 'draw' && s.player === viewer) for (const c of s.cards ?? []) visible.add(c.id);
    if (s.type === 'challenge' && s.player === viewer) for (const c of s.hand ?? []) visible.add(c.id);
  }
  const walk = (x: unknown, path: string) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.id === 'number' && typeof o.kind === 'string') {
      assert.ok(visible.has(o.id), `hidden card ${o.id} shown to ${viewer ?? 'a spectator'} at ${path} (${where})`);
    }
    for (const [k, val] of Object.entries(o)) walk(val, `${path}.${k}`);
  };
  walk(v, 'view');
  assert.equal(v.you === null, !viewer, `you view (${where})`);
  if (v.you) assert.deepEqual(v.you.hand.map(c => c.id), own.map(c => c.id), `own hand (${where})`);
  for (const p of v.players) assert.equal(p.cards, g.player(p.id).hand.length, `hand count (${where})`);
  assert.equal(v.drawCount, g.pile.length);
  // A Wild Draw Four's legality is secret until someone challenges it.
  const json = JSON.stringify(v);
  assert.ok(!json.includes('"legal"') && !json.includes('"check"') && !json.includes('"pile"'), `secret state in a view (${where})`);
}

function randomRules(r: (n: number) => number): Partial<CardsRules> {
  return {
    match: r(3) === 0 ? 'points' : 'single',
    targetScore: 50 + r(250),
    turnSeconds: r(2) ? 0 : 20,
    stacking: !!r(2), stackMixed: !!r(2), sevenZero: !!r(2), jumpIn: !!r(2),
    drawUntilPlayable: r(4) === 0, forcedPlay: !!r(2), noBluff: !!r(2),
  };
}

interface Tally { games: number; steps: number; rounds: number; timeouts: number; refused: number; leaves: number; byStep: Record<string, number> }

function runGame(seed: number, tally: Tally) {
  const r = seeded(seed);
  const n = 2 + r(9);
  let clock = 1_000_000;
  const humans = new Set<string>();
  const players = Array.from({ length: n }, (_, i) => {
    const human = r(4) === 0;
    if (human) humans.add(`p${i}`);
    return { id: `p${i}`, name: `P${i}`, isBot: !human, level: LEVELS[r(3)] };
  });
  const g = new CardsGame({ players, rules: randomRules(r), rng: seeded(seed * 7919 + 1), now: () => clock });
  let steps = 0;
  let lastSeq = -1;
  const where = () => `seed ${seed} step ${steps}`;
  while (g.phase !== 'over') {
    steps++;
    assert.ok(steps <= STEP_CAP, `game did not end (${where()})`);
    checkInvariants(g, where());
    if (g.lastPlay && g.lastPlay.seq !== lastSeq) {
      lastSeq = g.lastPlay.seq;
      for (const s of g.lastPlay.steps) tally.byStep[s.type] = (tally.byStep[s.type] ?? 0) + 1;
    }
    if (steps % 17 === 0) {
      const viewer = r(n + 1) === n ? undefined : `p${r(n)}`;
      checkNoLeak(g, g.view(viewer), viewer, where());
    }
    if (g.phase === 'roundOver') {
      clock = g.nextRoundAt!;
      assert.ok(g.clockTimeout(), `round break did not end (${where()})`);
      tally.rounds++;
      continue;
    }
    // Now and then: junk from anyone, refused with the game untouched.
    if (r(40) === 0) {
      const who = r(5) === 0 ? 'stranger' : `p${r(n)}`;
      const junk = JUNK[r(JUNK.length)];
      assertRefused(g, () => g.apply(who, junk as CardsAction), undefined);
      tally.refused++;
    }
    // Rarely, someone leaves.
    if (r(1500) === 0 && g.active().length > 2) {
      const alive = g.active();
      g.forfeit(alive[r(alive.length)].id);
      tally.leaves++;
      continue;
    }
    // Who acts next: every automated seat that wants to, after its think time.
    let best: { id: string; a: CardsAction; t: number } | null = null;
    const reactions = Object.keys(g.oneCard).length > 0 || g.rules.jumpIn;
    for (const p of g.active()) {
      if (!reactions && p !== g.current) continue;
      let a = cardsBotAction(g, p.id);
      if (!a) continue;
      if (humans.has(p.id)) {
        if (p.afk) a = cardsAutopilotAction(g, p.id, a);
        // Humans wander off now and then (their turn then times out).
        else if (g.rules.turnSeconds > 0 && r(6) === 0) continue;
        if (!a) continue;
      }
      const t = cardsBotThinkMs(g, p.id, a);
      if (!best || t < best.t) best = { id: p.id, a, t };
    }
    const due = g.clockDeadline();
    if (due !== null && (!best || due <= clock + best.t)) {
      clock = Math.max(clock, due);
      assert.ok(g.clockTimeout(), `deadline passed without effect (${where()})`);
      tally.timeouts++;
      continue;
    }
    assert.ok(best, `nobody can move (${where()}, phase ${g.phase}, current ${g.current.id})`);
    clock += best.t;
    try {
      g.apply(best.id, best.a, { auto: !humans.has(best.id) || g.player(best.id).afk });
    } catch (e) {
      assert.fail(`${best.id} chose ${JSON.stringify(best.a)} and was refused: ${(e as Error).message} (${where()})`);
    }
  }
  checkInvariants(g, where());
  const w = g.player(g.winner!);
  if (g.rules.match === 'points' && g.active().length > 1) assert.ok(w.score >= g.rules.targetScore, `winner short of the target (${where()})`);
  tally.games++;
  tally.steps += steps;
}

test(`fuzz: ${GAMES} all-bot games, 2–10 players, random house rules`, () => {
  const tally: Tally = { games: 0, steps: 0, rounds: 0, timeouts: 0, refused: 0, leaves: 0, byStep: {} };
  for (let seed = 1; seed <= GAMES; seed++) runGame(seed, tally);
  assert.equal(tally.games, GAMES);
  // The run really exercised the rules, not just plain number cards.
  for (const k of ['deal', 'flip', 'play', 'draw', 'skip', 'reverse', 'color', 'swap', 'rotate', 'challenge', 'call', 'catch', 'pass', 'timeout', 'reshuffle', 'roundEnd', 'leave']) {
    assert.ok((tally.byStep[k] ?? 0) > 0, `no ${k} step in ${GAMES} games`);
  }
  assert.ok(tally.timeouts > 0 && tally.refused > 0 && tally.rounds > 0);
  assert.equal(CARDS_DECK_SIZE, 108);
  void CardsError;
});
