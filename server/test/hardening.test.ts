// Regressions from the security / robustness audit: untrusted client input,
// timers that must never take the process down, automated moves that must
// never bankrupt anyone, and rooms that must not live (or multiply) forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, Game, type GameSnapshot } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import { Room, type RoomHooks } from '../src/rooms.ts';
import type { Action, Trade } from '../../shared/types.ts';
import { scripted } from './helpers.ts';

const CLASSIC = resolveTheme('classic', 'classic');

// ---- untrusted actions -------------------------------------------------------

test('malformed trade offers are refused and nothing is stored', () => {
  const { g, act } = scripted();
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  const ok = { cash: 0, spaces: [1], jailCards: 0 };
  const bad: unknown[] = [
    'spaces', null, 42, [], [1, 2],
    { cash: 0, spaces: '1', jailCards: 0 },
    { cash: 0, spaces: { 0: 1, length: 1 }, jailCards: 0 },
    { cash: 0, spaces: [{ i: 1 }], jailCards: 0 },
    { cash: 0, spaces: [1.5], jailCards: 0 },
    { cash: 0, spaces: [-1], jailCards: 0 },
    { cash: 0, spaces: [40], jailCards: 0 },
    { cash: 0, spaces: ['1'], jailCards: 0 },
    { cash: 0, spaces: [1, 1], jailCards: 0 },
    { cash: 0, spaces: Array.from({ length: 100_000 }, () => 1), jailCards: 0 },
    { cash: NaN, spaces: [1], jailCards: 0 },
    { cash: -5, spaces: [1], jailCards: 0 },
    { cash: '5', spaces: [1], jailCards: 0 },
    { cash: { valueOf: 5 }, spaces: [1], jailCards: 0 },
    { cash: 0, spaces: [1], jailCards: 0.5 },
    { cash: 0, spaces: [1], jailCards: 1 }, // has none
    { cash: 1e12, spaces: [1], jailCards: 0 },
  ];
  for (const give of bad) {
    assert.throws(() => act('p0', { type: 'proposeTrade', to: 'p1', give, get: ok } as unknown as Action), EngineError, JSON.stringify(give)?.slice(0, 60));
  }
  for (const to of [null, 5, { id: 'p1' }, ['p1'], 'x'.repeat(500), '']) {
    assert.throws(() => act('p0', { type: 'proposeTrade', to, give: ok, get: { cash: 0, spaces: [], jailCards: 0 } } as unknown as Action), EngineError);
  }
  assert.throws(() => act('p0', { type: 'proposeTrade', to: 'p1', give: ok, get: { cash: 0, spaces: [], jailCards: 0 }, counterOf: { id: 't1' } } as unknown as Action), EngineError);
  assert.equal(g.trades.length, 0, 'nothing malformed was stored');

  // Extra fields are dropped: what is stored is rebuilt from checked values.
  act('p0', { type: 'proposeTrade', to: 'p1', give: { ...ok, evil: { deep: true } }, get: { cash: 0, spaces: [], jailCards: 0, x: 1 } } as unknown as Action);
  assert.deepEqual(g.trades[0].give, ok);
  assert.deepEqual(Object.keys(g.trades[0].get).sort(), ['cash', 'jailCards', 'spaces']);
  // …and bots can read every stored offer.
  assert.doesNotThrow(() => botAction(g, 'p1'));
});

test('malformed spaces, bids, ids and unknown actions are EngineErrors', () => {
  const { g, dice, act } = scripted(3);
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  for (const type of ['build', 'sell', 'mortgage', 'unmortgage']) {
    for (const space of [null, '1', 1.5, -1, 40, NaN, '__proto__', 'constructor', [1], { space: 1 }]) {
      assert.throws(() => act('p0', { type, space } as unknown as Action), EngineError, `${type} ${String(space)}`);
    }
  }
  for (const id of [null, 1, { id: 't1' }, ['t1']]) {
    assert.throws(() => act('p1', { type: 'acceptTrade', id } as unknown as Action), EngineError);
    assert.throws(() => act('p1', { type: 'rejectTrade', id } as unknown as Action), EngineError);
  }
  for (const a of [{ type: 'teleport' }, { type: 'toString' }, { type: '__proto__' }, { type: 5 }, null, 'roll']) {
    assert.throws(() => act('p0', a as unknown as Action), EngineError, JSON.stringify(a));
  }
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  for (const amount of [NaN, '50', 10.5, -1, 0, null, { amount: 5 }, 1e9]) {
    assert.throws(() => act('p1', { type: 'bid', amount } as unknown as Action), EngineError, String(amount));
  }
  assert.equal(g.auction!.highBid, 0);
  assert.equal(g.auction!.highBidder, null);
});

test('the socket layer only accepts plain-object payloads', async () => {
  const { plainPayload } = await import('../src/sockets.ts');
  assert.equal(plainPayload(undefined), true);
  assert.equal(plainPayload(null), true);
  assert.equal(plainPayload({ type: 'roll' }), true);
  assert.equal(plainPayload(JSON.parse('{"__proto__": {"x": 1}}')), true, 'parsed JSON is a plain object');
  for (const p of ['roll', 5, true, [{ type: 'roll' }], Buffer.from('x'), new Date(), () => 1]) {
    assert.equal(plainPayload(p), false, String(p));
  }
});

test('a snapshot holding a malformed offer still restores, without it', () => {
  const { g } = scripted();
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  const snap = JSON.parse(JSON.stringify(g.snapshot())) as GameSnapshot;
  snap.trades = [
    { id: 't1', from: 'p0', to: 'p1', give: { cash: 0, spaces: '1' as unknown as number[], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } },
    { id: 't2', from: 'p0', to: 'p1', give: { cash: 0, spaces: [1], jailCards: 0 }, get: { cash: 10, spaces: [], jailCards: 0 } },
  ];
  const g2 = Game.restore({ theme: CLASSIC, rules: { ...DEFAULT_RULES } }, snap);
  assert.deepEqual(g2.trades.map(t => t.id), ['t2']);
  assert.doesNotThrow(() => botAction(g2, 'p1'));
});

// ---- room timers and automated moves ----------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const quietHooks = (): RoomHooks => ({ onChange() {}, onEvent() {}, onFinished() {} });

/** A started room with one human ('a') and one bot; timers stopped so tests drive it. */
function botRoom(code: string) {
  const r = new Room(code, 'a', quietHooks());
  r.join({ id: 'a', name: 'A', avatar: '' });
  r.addBot('a', false);
  r.start('a', false);
  r.dispose();
  const bot = r.seats.find(s => s.isBot)!.id;
  return { r, g: r.game!, bot };
}

/** Capture console.error for the duration of `fn`. */
async function capturingErrors(fn: (logged: string[]) => Promise<void> | void) {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };
  try { await fn(logged); } finally { console.error = orig; }
}

test('a timer body that throws is logged with the room code and re-armed, not fatal', async () => {
  const { r, g, bot } = botRoom('BOOM1');
  g.currentIdx = g.players.findIndex(p => p.id === bot);
  const apply = g.apply;
  g.apply = () => { throw new TypeError('engine bug'); };
  await capturingErrors(async logged => {
    r.setConnected('a', true); // re-arms the timers: the bot moves in ~1 s
    await sleep(1_200);
    assert.ok(logged.some(l => l.includes('[room BOOM1]') && l.includes('engine bug')), logged.join('\n'));
    const retry = (r as unknown as { retryTimer: NodeJS.Timeout | null }).retryTimer;
    assert.ok(retry, 'the timers are re-armed after a pause');
  });
  g.apply = apply;
  assert.equal(r.status, 'playing');
  r.dispose();
});

test('the automated-move picker skips a seat whose bot code throws', async () => {
  const { r, g, bot } = botRoom('BOOM2');
  g.currentIdx = g.players.findIndex(p => p.id === bot);
  // Something no validated path can store any more, standing in for any bot bug.
  g.trades.push({ id: 'tx', from: 'a', to: bot, give: null, get: null } as unknown as Trade);
  await capturingErrors(logged => {
    const next = (r as unknown as { nextAutomatedAction(now: number): unknown }).nextAutomatedAction(Date.now());
    assert.equal(next, null);
    assert.ok(logged.some(l => l.includes('[room BOOM2]')));
  });
  r.dispose();
});

test('a stale trade is rejected, never accepted into a failure (or a bankruptcy)', () => {
  const { r, g, bot } = botRoom('STALE');
  g.currentIdx = g.players.findIndex(p => p.id === bot);
  g.apply('a', { type: 'proposeTrade', to: bot, give: { cash: 1000, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  assert.equal(botAction(g, bot)?.type, 'acceptTrade', 'a gift is worth taking');
  g.player('a').cash = 10; // …but the cash is spent before the bot gets to it
  assert.deepEqual(botAction(g, bot), { type: 'rejectTrade', id: g.trades[0].id });
  // Even if an accept does fail (a race), the fallback declines it instead.
  (r as unknown as { fallback(id: string, a: Action): void }).fallback(bot, { type: 'acceptTrade', id: g.trades[0].id });
  assert.equal(g.trades.length, 0);
  assert.equal(g.player(bot).bankrupt, false);
  r.dispose();
});

test('a debt during an auction: the bot waits, and the fallback never resigns for it', () => {
  const { r, g, bot } = botRoom('DEBT1');
  g.owned[1] = { owner: bot, houses: 0, mortgaged: false };
  g.auction = { space: 3, highBid: 50, highBidder: bot, bidders: ['a', bot], endsAt: Date.now() + 60_000 };
  g.phase = 'auction';
  g.player(bot).cash = 100;
  g.debts.push({ from: bot, to: 'a', amount: 5_000, reason: 'test' });
  assert.equal(botAction(g, bot), null, 'no mortgaging (locked) and no bidding while it owes more than it has');
  g.auction.highBidder = 'a';
  assert.deepEqual(botAction(g, bot), { type: 'pass' });
  g.auction.highBidder = bot;
  // The old fallback went pass → endTurn → bankrupt; neither applies here.
  (r as unknown as { fallback(id: string, a: Action): void }).fallback(bot, { type: 'mortgage', space: 1 });
  assert.equal(g.player(bot).bankrupt, false);
  assert.equal(g.phase, 'auction');
  r.dispose();
});
