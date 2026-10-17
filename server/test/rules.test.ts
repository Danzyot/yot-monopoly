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
