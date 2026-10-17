// Regressions from the security / robustness audit: untrusted client input,
// timers that must never take the process down, automated moves that must
// never bankrupt anyone, and rooms that must not live (or multiply) forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError, Game, type GameSnapshot } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import type { Action } from '../../shared/types.ts';
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
