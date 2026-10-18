// Random legal and illegal actions from random senders — spectators, the wrong
// player, bankrupt players, stale auction bids, trades naming deeds that have
// changed hands, negative / NaN / huge amounts, unknown action types — thrown
// at seeded games. The engine must either apply an action or refuse it with an
// EngineError that leaves the state untouched; every invariant holds throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, Game } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, resolveTheme, type RuleConfig } from '../../shared/themes.ts';
import { MAPS } from '../../shared/maps.ts';
import type { Action, TurnPhase } from '../../shared/types.ts';
import { checkInvariants } from './sim.ts';
import { seeded } from './helpers.ts';

const PHASES: TurnPhase[] = ['roll', 'buy', 'auction', 'done', 'minigame', 'choose', 'over'];
const NUMBERS = [-1, 0, 1, 5, 50, 1.5, -1e9, 1e300, 2 ** 53, NaN, Infinity, -Infinity, '5', null, undefined, true, [], {}];
const TYPES = ['roll', 'buy', 'decline', 'bid', 'pass', 'endTurn', 'payJail', 'useJailCard', 'build', 'sell', 'mortgage',
  'unmortgage', 'payDebt', 'bankrupt', 'proposeTrade', 'acceptTrade', 'rejectTrade', 'minigame', 'choose',
  'nonsense', '', 'adminSetCash', 'constructor', '__proto__'];
const MOVE_KINDS = ['roll', 'higher', 'lower', 'cashOut', 'tap', 'answer', 'spin', 'continue', 'bogus', 42, null];

/** Structural checks the sim's checkInvariants() does not make. */
function checkStructure(g: Game, where: string) {
  assert.ok(PHASES.includes(g.phase), `bad phase ${g.phase} (${where})`);
  if (g.phase !== 'auction' && g.phase !== 'over') assert.ok(!g.current.bankrupt, `bankrupt current player (${where})`);
  assert.ok(Number.isSafeInteger(g.pot) && g.pot >= 0, `bad pot (${where})`);
  const alive = new Set(g.active().map(p => p.id));
  for (const p of g.players) {
    assert.ok(Number.isSafeInteger(p.cash), `cash not a whole number ${p.id} (${where})`);
    assert.ok(p.position >= 0 && p.position < g.size, `off the board ${p.id} (${where})`);
    for (const d of p.jailCards) assert.ok(d === 'chance' || d === 'chest', `bad jail card (${where})`);
  }
  for (const [k, o] of Object.entries(g.owned)) {
    const s = g.spaces[Number(k)];
    assert.ok(s && (s.price ?? 0) > 0, `owned space that cannot be owned (${where})`);
    assert.ok(alive.has(o.owner), `deed owned by nobody alive (${where})`);
    assert.ok(Number.isInteger(o.houses) && o.houses >= 0 && o.houses <= 5, `bad house count (${where})`);
  }
  for (const d of g.debts) {
    assert.ok(Number.isSafeInteger(d.amount) && d.amount > 0, `bad debt amount (${where})`);
    assert.ok(alive.has(d.from), `debt from nobody alive (${where})`);
  }
  for (const t of g.trades) {
    assert.ok(alive.has(t.from) && alive.has(t.to) && t.from !== t.to, `trade between the wrong people (${where})`);
    for (const side of [t.give, t.get]) {
      assert.ok(Number.isSafeInteger(side.cash) && side.cash >= 0, `bad trade cash (${where})`);
      assert.ok(Number.isSafeInteger(side.jailCards) && side.jailCards >= 0, `bad trade card count (${where})`);
      for (const i of side.spaces) assert.ok(Number.isInteger(i) && i >= 0 && i < g.size, `bad trade space (${where})`);
    }
  }
  if (g.auction) {
    assert.equal(g.phase, 'auction', `auction outside its phase (${where})`);
    assert.ok(!g.owned[g.auction.space], `auctioning an owned deed (${where})`);
    assert.ok(Number.isSafeInteger(g.auction.highBid) && g.auction.highBid >= 0, `bad high bid (${where})`);
    if (g.auction.highBidder) assert.ok(g.auction.bidders.includes(g.auction.highBidder), `high bidder left (${where})`);
  } else assert.notEqual(g.phase, 'auction', `auction phase with no auction (${where})`);
  if (g.phase === 'minigame') assert.ok(g.minigame, `minigame phase with no round (${where})`);
  if (g.phase === 'over') assert.ok(g.winner && alive.has(g.winner), `game over with no winner (${where})`);
}

/** A random, mostly malformed action. */
function randomAction(g: Game, rnd: (n: number) => number, ids: string[]): Action {
  const pick = <T>(xs: readonly T[]): T => xs[rnd(xs.length)];
  const num = () => (rnd(3) === 0 ? pick(NUMBERS) : rnd(g.size + 4) - 2);
  const side = () => (rnd(6) === 0 ? pick(NUMBERS) : {
    cash: rnd(2) ? num() : 0,
    spaces: rnd(4) === 0 ? pick(NUMBERS) : Array.from({ length: rnd(4) }, () => num()),
    jailCards: rnd(3) === 0 ? num() : 0,
  });
  // Mostly real action types from real players, so plenty of odd-but-legal moves get through too.
  const type = rnd(4) === 0 ? pick(TYPES) : pick(TYPES.filter(t => t !== 'bankrupt').slice(0, 18));
  const players = ids.filter(i => i.startsWith('p'));
  const a: Record<string, unknown> = { type };
  switch (type) {
    case 'bid': a.amount = rnd(2) ? num() : (g.auction?.highBid ?? 0) + rnd(80) + 1; break;
    case 'decline': a.endTurn = pick([true, false, 'yes', 1, undefined]); break;
    case 'build': case 'sell': case 'mortgage': case 'unmortgage': a.space = num(); break;
    case 'choose': a.value = num(); break;
    case 'proposeTrade':
      a.to = rnd(5) === 0 ? pick(NUMBERS) : rnd(3) ? pick(players) : pick(ids);
      a.give = side();
      a.get = side();
      if (rnd(3) === 0) a.counterOf = rnd(2) ? `t${rnd(60)}` : pick(NUMBERS);
      break;
    case 'acceptTrade': case 'rejectTrade':
      a.id = rnd(3) === 0 ? pick(NUMBERS) : rnd(2) && g.trades.length ? pick(g.trades).id : `t${rnd(60)}`;
      break;
    case 'minigame':
      a.move = rnd(6) === 0 ? pick(NUMBERS) : { kind: pick(MOVE_KINDS), value: num() };
      break;
    default: break;
  }
  if (rnd(10) === 0) a.extra = { junk: true };
  return a as unknown as Action;
}

/** Everything about a game that a refused action must not have touched. */
function fingerprint(g: Game): string {
  return JSON.stringify([g.players, g.owned, g.currentIdx, g.phase, g.dice, g.debts, g.auction, g.trades, g.pot,
    g.housesLeft, g.hotelsLeft, g.decks, g.minigame, g.outOrder, g.winner, g.turnNumber, g.extraRoll, g.choice, g.speed]);
}

// Ad-hoc longer hunts: FUZZ_SEEDS=500 npx tsx --test server/test/fuzz.test.ts
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 16);

test('fuzz: random legal and illegal actions never corrupt a game', () => {
  let applied = 0, refused = 0, randomApplied = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rnd = seeded(seed * 7919);
    const map = MAPS[seed % MAPS.length];
    const rules: RuleConfig = {
      ...DEFAULT_RULES,
      startingCash: map.startingCash ?? 1500,
      freeParkingPot: rnd(2) === 0, doubleOnGo: rnd(2) === 0, auctions: rnd(4) !== 0,
      evenBuild: rnd(4) !== 0, limitedBuildings: rnd(4) !== 0, noRentInJail: rnd(3) === 0,
      speedDie: rnd(2) === 0, minigames: rnd(2) === 0, arcadeParking: rnd(3) === 0,
      turnSeconds: rnd(2) ? 20 : 0, timeLimitMin: rnd(4) === 0 ? 2 : 0,
    };
    let clock = 0;
    let bank = 0;
    const n = 2 + (seed % 4);
    const init = { theme: resolveTheme(seed % 2 ? 'classic' : 'chog', map.id), rules, rng: seeded(seed), now: () => clock, onBank: (x: number) => { bank += x; } };
    let g = new Game({
      ...init,
      players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, character: 'spiky' as const, color: '#fff', isBot: i % 2 === 0 })),
    });
    const start = g.players.reduce((s, p) => s + p.cash, 0);
    const senders = [...g.players.map(p => p.id), 'spectator', '', 'x'.repeat(100)];
    for (let step = 0; step < 1200 && g.phase !== 'over'; step++) {
      clock += 300;
      const where = `seed ${seed} step ${step}`;
      const legal = rnd(2) === 0;
      let who: string;
      let a: Action | null;
      if (legal) {
        // A sensible move from whoever has one, so the game gets somewhere.
        const order = [g.current, ...g.players.filter(x => x !== g.current)].filter(p => !p.bankrupt);
        who = order[0].id;
        a = null;
        for (const p of order) {
          a = botAction(g, p.id);
          if (a) { who = p.id; break; }
        }
      } else {
        who = rnd(3) ? g.players[rnd(g.players.length)].id : senders[rnd(senders.length)];
        a = randomAction(g, rnd, senders);
      }
      if (a && legal) {
        // A bot's move is always legal: a refusal here is a bot defect.
        g.apply(who, a);
        applied++;
      } else if (a) {
        const before = fingerprint(g);
        try {
          g.apply(who, a);
          applied++;
          randomApplied++;
        } catch (e) {
          assert.ok(e instanceof EngineError, `${where}: ${who} ${JSON.stringify(a)} threw ${(e as Error).stack}`);
          assert.equal(fingerprint(g), before, `${where}: refused ${JSON.stringify(a)} but state changed`);
          refused++;
        }
      } else if (g.phase === 'minigame') {
        clock = Math.max(clock, g.minigameDeadline() ?? clock);
        g.minigameTimeout();
      } else if (g.phase === 'auction') {
        clock = Math.max(clock, g.auction!.endsAt);
        g.auctionTimeout();
      } else {
        const due = g.clockDeadline();
        assert.ok(due !== null, `stuck in ${g.phase} (${where})`);
        clock = Math.max(clock, due);
        g.clockTimeout();
      }
      if ((g.clockDeadline() ?? Infinity) <= clock) g.clockTimeout();
      checkInvariants(g, start, bank, where);
      checkStructure(g, where);
      if (step % 97 === 96) {
        JSON.stringify(g.view());
        g = Game.restore(init, JSON.parse(JSON.stringify(g.snapshot())));
        checkInvariants(g, start, bank, `restored ${where}`);
        checkStructure(g, `restored ${where}`);
      }
    }
  }
  if (process.env.FUZZ_DEBUG) console.log({ applied, refused, randomApplied });
  assert.ok(applied > 500 && refused > 500, `too few actions exercised (${applied} applied, ${refused} refused)`);
});
