// Official Monopoly rules (and the documented house-rule toggles), one
// regression test per rule the engine once got wrong or left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../../shared/themes.ts';
import { scripted } from './helpers.ts';

const CLASSIC = resolveTheme('classic', 'classic');
const own = (owner: string, houses = 0, mortgaged = false) => ({ owner, houses, mortgaged });

test('free parking pot: jail fines go to the bank, not the pot (paid or forced)', () => {
  const { g, dice, act } = scripted(2, { freeParkingPot: true, auctions: false });
  const p = g.player('p0');
  p.inJail = true; p.position = 10;
  act('p0', { type: 'payJail' });
  assert.equal(p.cash, 1450);
  assert.equal(g.pot, 0);
  // Third failed attempt: the forced fine goes to the bank too.
  p.inJail = true; p.jailTurns = 2; p.position = 10;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(p.inJail, false);
  assert.equal(p.cash, 1400);
  assert.equal(g.pot, 0);
  // Card fines and taxes still feed it.
  act('p0', { type: 'decline', endTurn: true }); // landed on unowned 13
  const fine = CLASSIC.chance.findIndex(c => c.effect.type === 'pay');
  g.decks.chance = [fine];
  dice(3, 4); // p1: 0 → 7 Chance, speeding fine 15
  act('p1', { type: 'roll' });
  assert.equal(g.pot, 15);
});

test('money owed is not there to spend: no buying, building, lifting mortgages or paying out in trades', () => {
  const { g, dice, act } = scripted(2);
  g.owned[1] = own('p0'); g.owned[3] = own('p0'); g.owned[5] = own('p0', 0, true);
  g.owned[39] = own('p1');
  const p = g.player('p0');
  g.debts.push({ from: 'p0', to: 'p1', amount: 1450, reason: 'test' }); // 50 spare
  assert.throws(() => act('p0', { type: 'build', space: 1 }), /Settle your debts first/);
  assert.throws(() => act('p0', { type: 'unmortgage', space: 5 }), /Settle your debts first/);
  // Paying out cash in a trade: refused; selling a deed for cash: fine.
  const side = (cash: number, spaces: number[] = []) => ({ cash, spaces, jailCards: 0 });
  assert.throws(() => act('p0', { type: 'proposeTrade', to: 'p1', give: side(100), get: side(0, [39]) }), /cannot pay out cash/);
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(40), get: side(0, [39]) }); // within the 50 spare
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(0, [1]), get: side(300) });
  // The offer that pays out is re-checked at accept time.
  g.debts[0].amount = 1500;
  assert.throws(() => act('p1', { type: 'acceptTrade', id: 't1' }), /cannot pay out cash/);
  act('p1', { type: 'acceptTrade', id: 't2' });
  assert.equal(p.cash, 1800);
  // Buying: only with what is left over the debt.
  g.debts = [];
  dice(3, 3); // 0 → 6
  act('p0', { type: 'roll' });
  assert.equal(g.phase, 'buy');
  g.debts.push({ from: 'p0', to: 'p1', amount: 1730, reason: 'test' }); // 70 spare, Oriental costs 100
  assert.throws(() => act('p0', { type: 'buy' }), /Settle your debts first/);
  act('p0', { type: 'payDebt' });
  assert.equal(p.cash, 70);
  act('p0', { type: 'mortgage', space: 3 });
  act('p0', { type: 'buy' });
  assert.equal(g.owned[6].owner, 'p0');
});
