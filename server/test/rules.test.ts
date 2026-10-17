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

test('mortgaged deed received in a trade: 10% now, and lifting it at once costs only the principal', () => {
  const { g, dice, act } = scripted(2, { auctions: false });
  g.owned[39] = own('p0', 0, true); // mortgage 200
  g.owned[37] = own('p0', 0, true); // mortgage 175
  const side = (cash: number, spaces: number[] = []) => ({ cash, spaces, jailCards: 0 });
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(0, [37, 39]), get: side(100) });
  act('p1', { type: 'acceptTrade', id: g.trades[0].id });
  const p1 = g.player('p1');
  assert.equal(p1.cash, 1500 - 100 - 20 - 18);
  assert.equal(g.owned[39].interestPaid, true);
  act('p1', { type: 'unmortgage', space: 39 }); // at once: principal only
  assert.equal(p1.cash, 1362 - 200);
  assert.equal(g.owned[39].interestPaid, undefined);
  // Once the turn ends, lifting costs principal plus 10% again.
  dice(1, 2); // 0 → 3, Baltic (no auctions here)
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline', endTurn: true });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.owned[37].interestPaid, undefined);
  const before = p1.cash;
  act('p1', { type: 'unmortgage', space: 37 });
  assert.equal(p1.cash, before - 193);
});

test('bankruptcy: debts are met in order; the first that cannot be met takes everything left', () => {
  // Chairman of the Board with $40: owes p1 and p2 $50 each. p1 is first in line.
  const { g, dice, act } = scripted(3);
  g.owned[1] = own('p0', 0, true); // mortgaged: p1 pays 10% on it
  g.owned[3] = own('p0');
  g.player('p0').jailCards = ['chest'];
  g.decks.chest = g.decks.chest.filter(i => CLASSIC.chest[i].effect.type !== 'jailFree');
  g.player('p0').cash = 40;
  const chair = CLASSIC.chance.findIndex(c => c.effect.type === 'payEach');
  g.decks.chance = [chair];
  dice(3, 4);
  act('p0', { type: 'roll' });
  assert.equal(g.debtOf('p0'), 100);
  act('p0', { type: 'bankrupt' });
  const p1 = g.player('p1');
  assert.equal(g.owned[1].owner, 'p1');
  assert.equal(g.owned[3].owner, 'p1');
  assert.deepEqual(p1.jailCards, ['chest']);
  assert.equal(p1.cash, 1500 + 40 - 3, 'cash plus the remaining $40, less 10% on the mortgaged deed');
  assert.equal(g.player('p2').cash, 1500, 'the later debt dies with the bankrupt');
  assert.equal(g.debts.length, 0);

  // A bank debt that can be met is paid first; the player creditor gets the rest.
  const b = scripted(3);
  b.g.owned[39] = own('p0', 2);
  b.g.owned[37] = own('p0', 2);
  b.g.player('p0').cash = 100;
  b.g.debts.push({ from: 'p0', to: null, amount: 75, reason: 'tax' }, { from: 'p0', to: 'p2', amount: 2000, reason: 'rent on X' });
  // And money p1 owes the bankrupt now goes to the creditor.
  b.g.debts.push({ from: 'p1', to: 'p0', amount: 30, reason: 'card' });
  b.act('p0', { type: 'bankrupt' });
  // Buildings back at half price: 4 houses × 100 = 400; 500 - 75 = 425 to p2.
  assert.equal(b.g.player('p2').cash, 1925);
  assert.equal(b.g.owned[39].owner, 'p2');
  assert.equal(b.g.owned[39].houses, 0);
  assert.deepEqual(b.g.debts, [{ from: 'p1', to: 'p2', amount: 30, reason: 'card' }]);
});

test('selling a hotel: four houses back from the bank; in a shortage the group sells down further, evenly', () => {
  // Plenty of houses: the hotel becomes four houses.
  const a = scripted(2);
  a.g.owned[37] = own('p0', 5); a.g.owned[39] = own('p0', 5);
  a.g.housesLeft = 32; a.g.hotelsLeft = 10;
  a.act('p0', { type: 'sell', space: 39 });
  assert.equal(a.g.owned[39].houses, 4);
  assert.equal(a.g.housesLeft, 28);
  assert.equal(a.g.hotelsLeft, 11);
  assert.equal(a.g.player('p0').cash, 1600);

  // Two houses left in the bank: no even arrangement keeps the other hotel
  // (it would need 4 houses beside it), so both lots come down to one house.
  const b = scripted(2);
  b.g.owned[37] = own('p0', 5); b.g.owned[39] = own('p0', 5);
  b.g.housesLeft = 2; b.g.hotelsLeft = 10;
  b.act('p0', { type: 'sell', space: 39 });
  assert.equal(b.g.owned[37].houses, 1);
  assert.equal(b.g.owned[39].houses, 1);
  assert.equal(b.g.housesLeft, 0);
  assert.equal(b.g.hotelsLeft, 12);
  assert.equal(b.g.player('p0').cash, 1500 + 800, 'eight levels sold at $100');

  // A lot with houses already: (5, 4) with none in the bank → the hotel breaks
  // into the houses the group already has, spread evenly (2 + 2).
  const c = scripted(2);
  c.g.owned[37] = own('p0', 4); c.g.owned[39] = own('p0', 5);
  c.g.housesLeft = 0; c.g.hotelsLeft = 11;
  c.act('p0', { type: 'sell', space: 39 });
  assert.deepEqual([c.g.owned[37].houses, c.g.owned[39].houses].sort(), [2, 2]);
  assert.equal(c.g.housesLeft, 0);
  assert.equal(c.g.player('p0').cash, 1500 + 500);

  // Without even building only the hotel's lot drops, to what the bank has.
  const d = scripted(2, { evenBuild: false });
  d.g.owned[37] = own('p0', 5); d.g.owned[39] = own('p0', 5);
  d.g.housesLeft = 3; d.g.hotelsLeft = 10;
  d.act('p0', { type: 'sell', space: 39 });
  assert.deepEqual([d.g.owned[37].houses, d.g.owned[39].houses], [5, 3]);
  assert.equal(d.g.housesLeft, 0);

  // Unlimited buildings: always four houses.
  const e = scripted(2, { limitedBuildings: false });
  e.g.owned[37] = own('p0', 5); e.g.owned[39] = own('p0', 5);
  e.g.housesLeft = 0;
  e.act('p0', { type: 'sell', space: 39 });
  assert.equal(e.g.owned[39].houses, 4);
});
