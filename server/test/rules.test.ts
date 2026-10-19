// Official Monopoly rules (and the documented house-rule toggles), one
// regression test per rule the engine once got wrong or left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botAction, botThinkMs } from '../src/engine/bot.ts';
import { AUCTION_EXTEND_MS } from '../../shared/pacing.ts';
import { Room } from '../src/rooms.ts';
import { resolveTheme } from '../../shared/themes.ts';
import { SPEED_FACES, type Action } from '../../shared/types.ts';
import { scripted } from './helpers.ts';
import { simulate } from './sim.ts';

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

test('jail: the fine cannot be paid out of money already owed', () => {
  const { g, act } = scripted(2);
  const p = g.player('p0');
  p.inJail = true; p.position = 10;
  g.debts.push({ from: 'p0', to: 'p1', amount: 1480, reason: 'test' });
  assert.throws(() => act('p0', { type: 'payJail' }), /Settle your debts first/);
  act('p0', { type: 'payDebt' });
  assert.throws(() => act('p0', { type: 'payJail' }), /Not enough cash/);
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

test('speed die: Mr. Monopoly waits until the rent from the first landing is paid', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  const p0 = g.player('p0');
  p0.passedGo = true;
  p0.cash = 10;
  g.owned[1] = own('p1'); g.owned[39] = own('p1', 5);
  p0.position = 34;
  dice(2, 3); raw(SPEED_FACES.indexOf('mr')); // 34 → 39, $2000 rent
  act('p0', { type: 'roll' });
  assert.equal(p0.position, 39);
  assert.equal(g.debtOf('p0'), 2000);
  assert.equal(g.phase, 'done');
  assert.throws(() => act('p0', { type: 'endTurn' }), /debts/);
  p0.cash = 3000; // (raised somehow)
  act('p0', { type: 'payDebt' });
  // Now he moves on: past GO (+200), skipping p1's Mediterranean, to the first unowned deed (Baltic).
  assert.equal(p0.position, 3);
  assert.equal(g.phase, 'buy');
  assert.equal(p0.cash, 3000 - 2000 + 200);
});

test('autopilot never sells or mortgages unless money is owed (bot shortage play, set-completing buys)', () => {
  const r = new Room('AUTO', 'a', { onChange() {}, onEvent() {}, onFinished() {} });
  r.join({ id: 'a', name: 'A', avatar: '' });
  r.join({ id: 'b', name: 'B', avatar: '' });
  r.start('a', false);
  r.dispose();
  const g = r.game!;
  const cur = g.current.id;
  g.owned[1] = own(cur, 2); g.owned[3] = own(cur, 2);
  g.owned[37] = own(cur, 2); g.owned[39] = own(cur, 2);
  g.housesLeft = 0;
  g.player(cur).cash = 5000;
  g.phase = 'done';
  assert.equal(botAction(g, cur)?.type, 'sell', 'the bot itself would sell for its shortage play');
  r.setAutopilot('a', cur, true, false);
  r.dispose();
  const next = (r as unknown as { nextAutomatedAction(now: number): { action: Action } | null }).nextAutomatedAction(Date.now());
  assert.deepEqual(next?.action, { type: 'endTurn' });
  // Owing money, it raises it.
  g.owned[5] = own(cur);
  g.debts.push({ from: cur, to: null, amount: 5100, reason: 'test' });
  const raise = (r as unknown as { nextAutomatedAction(now: number): { action: Action } | null }).nextAutomatedAction(Date.now());
  assert.deepEqual(raise?.action, { type: 'mortgage', space: 5 });
  r.dispose();
});

// ---- official rules that were already right: pinned so they stay that way ------

test('salary: passing or landing on GO pays (double on landing with the house rule); jail never does', () => {
  const a = scripted(2, { doubleOnGo: true, auctions: false });
  a.g.player('p0').position = 38;
  a.dice(1, 1); // lands exactly on GO
  a.act('p0', { type: 'roll' });
  assert.equal(a.g.player('p0').cash, 1900);
  a.dice(1, 2); // doubles → roll again: 0 → 3
  a.act('p0', { type: 'roll' });
  assert.equal(a.g.player('p0').cash, 1900, 'leaving GO pays nothing');
  // Chance at 36 sends p1 to jail, round past GO: no salary.
  const jail = CLASSIC.chance.findIndex(c => c.effect.type === 'jail');
  a.act('p0', { type: 'decline', endTurn: true });
  a.g.decks.chance = [jail];
  a.g.player('p1').position = 33;
  a.dice(1, 2);
  a.act('p1', { type: 'roll' });
  assert.equal(a.g.player('p1').position, 10);
  assert.equal(a.g.player('p1').inJail, true);
  assert.equal(a.g.player('p1').cash, 1500);
  // Advance-to cards pay when they pass GO: Chance 36 → St. Charles (11).
  const charles = CLASSIC.chance.findIndex(c => c.effect.type === 'advance' && c.effect.to === 11);
  const b = scripted(2);
  b.g.decks.chance = [charles];
  b.g.player('p0').position = 33;
  b.dice(1, 2);
  b.act('p0', { type: 'roll' });
  assert.equal(b.g.player('p0').position, 11);
  assert.equal(b.g.player('p0').cash, 1700);
  assert.equal(b.g.phase, 'buy');
});

test('rent: a mortgaged lot in a set still leaves the others at double rent; no rent on it; railroads and utilities count it', () => {
  const { g } = scripted(2);
  g.owned[37] = own('p0', 0, true); g.owned[39] = own('p0');
  assert.equal(g.rentFor(39), 100, 'Boardwalk doubled: the set is owned even though Park Place is mortgaged');
  assert.equal(g.rentFor(37), 0);
  g.owned[5] = own('p0', 0, true); g.owned[15] = own('p0');
  assert.equal(g.rentFor(15), 50, 'two railroads owned');
  g.owned[12] = own('p0', 0, true); g.owned[28] = own('p0');
  assert.equal(g.rentFor(28, {}, 8), 80, 'both utilities: 10×');
});

test('jail: card returns to the bottom of its own deck, even after changing hands', () => {
  const { g, act } = scripted(2);
  const idx = CLASSIC.chest.findIndex(c => c.effect.type === 'jailFree');
  g.decks.chest = g.decks.chest.filter(i => i !== idx);
  g.player('p1').jailCards = ['chest'];
  act('p1', { type: 'proposeTrade', to: 'p0', give: { cash: 0, spaces: [], jailCards: 1 }, get: { cash: 30, spaces: [], jailCards: 0 } });
  act('p0', { type: 'acceptTrade', id: g.trades[0].id });
  assert.deepEqual(g.player('p0').jailCards, ['chest']);
  const p0 = g.player('p0');
  p0.inJail = true; p0.position = 10;
  act('p0', { type: 'useJailCard' });
  assert.equal(p0.inJail, false);
  assert.equal(g.decks.chest.at(-1), idx, 'bottom of Community Chest');
  assert.equal(g.decks.chest.length, CLASSIC.chest.length);
  assert.equal(g.phase, 'roll', 'and then rolls as usual');
});

test('jail: no paying out or using a card once rolled; three misses then the fine and move', () => {
  const { g, dice, act } = scripted(2);
  const p = g.player('p0');
  p.inJail = true; p.position = 10;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(p.inJail, true);
  assert.equal(p.position, 10);
  assert.equal(g.phase, 'done');
  assert.throws(() => act('p0', { type: 'payJail' }), /Can't do that now/);
  assert.throws(() => act('p0', { type: 'useJailCard' }), /Can't do that now/);
  assert.equal(p.jailTurns, 1);
  act('p0', { type: 'endTurn' });
  assert.equal(g.current.id, 'p1');
});

test('auction: the player who declined may bid and win; nobody bidding leaves it with the bank', () => {
  const { g, dice, act } = scripted(3);
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  assert.deepEqual(g.auction!.bidders, ['p0', 'p1', 'p2']);
  act('p0', { type: 'bid', amount: 1 });
  act('p1', { type: 'pass' }); act('p2', { type: 'pass' });
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.player('p0').cash, 1499, 'bidding starts at any amount');
  act('p0', { type: 'endTurn' });
  dice(1, 2);
  act('p1', { type: 'roll' }); // 0 → 3 owned by p0: rent
  assert.equal(g.phase, 'done');
});

test('auction: bots think 1.5-4 s, jump now and then, stop at their valuation and keep the log short', () => {
  const run = () => {
    const { g, dice, act, tick } = scripted(3);
    g.player('p1').isBot = true; g.player('p2').isBot = true;
    dice(1, 2);
    act('p0', { type: 'roll' });
    act('p0', { type: 'decline' });
    act('p0', { type: 'pass' }); // the human sits out; the two bots haggle over a $60 lot
    const bids: number[] = [];
    for (let i = 0; i < 100 && g.auction; i++) {
      const who = ['p1', 'p2'].find(id => botAction(g, id)?.type === 'bid');
      if (!who) break;
      const delay = botThinkMs(g, who, 900);
      assert.ok(delay >= 1500 && delay <= 4000, `think time ${delay}`);
      tick(delay);
      const a = botAction(g, who)!;
      assert.equal(a.type, 'bid');
      bids.push((a as { amount: number }).amount);
      act(who, a);
    }
    return { g, bids };
  };
  const { g, bids } = run();
  assert.deepEqual(run().bids, bids, 'seeded: the same auction plays out the same way');
  const inc = 5; // a $60 lot: 5% rounds to $3, the floor is $5
  assert.ok(bids.every((b, i) => b > (bids[i - 1] ?? 0)), 'bids only go up');
  assert.ok(Math.max(...bids) <= 66, `stopped at the valuation (${Math.max(...bids)})`);
  assert.ok(bids.some((b, i) => b - (bids[i - 1] ?? 0) > inc), `at least one jump bid in ${bids.join(',')}`);
  assert.ok(bids.length < 14, 'far fewer bids than creeping up by the minimum');
  // The auction ends on the clock; the log has the opening bid and the result, not every bid.
  const lines = g.log.filter(l => / bid \$\d/.test(l.text));
  assert.equal(lines.length, 1, 'only the opening bid is logged');
  assert.equal(g.auctionTimeout(), false);
  assert.ok(AUCTION_EXTEND_MS >= 5000, 'a human gets a few seconds after every bot bid');
});

test('auction: a human bid is always logged, and the think time is the usual one outside auctions', () => {
  const { g, dice, act } = scripted(3);
  g.player('p1').isBot = true;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(botThinkMs(g, 'p1', 900), 900);
  act('p0', { type: 'decline' });
  act('p1', { type: 'bid', amount: 10 });
  act('p0', { type: 'bid', amount: 15 });
  act('p1', { type: 'bid', amount: 20 });
  assert.equal(g.log.filter(l => / bid \$\d/.test(l.text)).length, 3);
});

test('cards: go back 3 spaces lands and resolves (Community Chest draws); repairs; pay each player short of cash', () => {
  const { g, dice, act } = scripted(3);
  const back = CLASSIC.chance.findIndex(c => c.effect.type === 'back');
  const birthday = CLASSIC.chest.findIndex(c => c.effect.type === 'collectEach');
  g.decks.chance = [back];
  g.decks.chest = [birthday];
  g.player('p0').position = 33;
  dice(1, 2); // 33 → 36 Chance → back to 33 Community Chest → birthday
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 33);
  assert.equal(g.player('p0').cash, 1520);
  act('p0', { type: 'endTurn' });

  // Repairs: $25 per house, $100 per hotel (Chance), into the pot only with the house rule.
  const rep = CLASSIC.chance.findIndex(c => c.effect.type === 'repairs');
  g.owned[37] = own('p1', 5); g.owned[39] = own('p1', 3);
  g.owned[1] = own('p1', 2); g.owned[3] = own('p1', 2);
  g.decks.chance = [rep];
  dice(3, 4); // p1: 0 → 7
  act('p1', { type: 'roll' });
  assert.equal(g.player('p1').cash, 1500 - 10 - (100 + 7 * 25), 'less the birthday $10');
  act('p1', { type: 'endTurn' });

  // Chairman of the Board with too little: pays whom it can, owes the rest.
  const chair = CLASSIC.chance.findIndex(c => c.effect.type === 'payEach');
  g.decks.chance = [chair];
  g.player('p2').cash = 70;
  dice(3, 4); // p2: 0 → 7
  act('p2', { type: 'roll' });
  assert.equal(g.player('p0').cash, 1570);
  assert.equal(g.debtOf('p2'), 50);
  assert.deepEqual(g.debts.map(d => d.to), ['p1']);
});

test('trades: any time, not just on your turn; deeds of a built-on group are refused; counter-offers replace', () => {
  const { g, act } = scripted(3);
  const side = (cash: number, spaces: number[] = []) => ({ cash, spaces, jailCards: 0 });
  g.owned[1] = own('p1'); g.owned[3] = own('p1');
  g.owned[6] = own('p2');
  act('p1', { type: 'proposeTrade', to: 'p2', give: side(0, [1]), get: side(0, [6]) });
  act('p2', { type: 'proposeTrade', to: 'p1', give: side(0, [6]), get: side(10, [1]), counterOf: g.trades[0].id });
  assert.equal(g.trades.length, 1);
  act('p1', { type: 'acceptTrade', id: g.trades[0].id }); // on p0's turn
  assert.equal(g.owned[6].owner, 'p1');
  g.owned[8] = own('p1'); g.owned[9] = own('p1');
  g.owned[6].houses = 1;
  assert.throws(() => act('p1', { type: 'proposeTrade', to: 'p2', give: side(0, [9]), get: side(5) }), /Sell the buildings/);
});

// ---- bots ---------------------------------------------------------------------

test('bot: a pointless swap within one colour group is declined; a fair set-for-set swap is taken', () => {
  const { g, act } = scripted(2);
  const side = (cash: number, spaces: number[] = []) => ({ cash, spaces, jailCards: 0 });
  // p0 holds Mediterranean, p1 Baltic: swapping them completes nothing for anyone.
  g.owned[1] = own('p0'); g.owned[3] = own('p1');
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(0, [1]), get: side(0, [3]) });
  assert.deepEqual(botAction(g, 'p1'), { type: 'rejectTrade', id: g.trades[0].id });
  act('p1', { type: 'rejectTrade', id: g.trades[0].id });
  // Each needs one lot the other has: Boardwalk for Ventnor (+ the difference).
  g.owned[26] = own('p0'); g.owned[27] = own('p1'); g.owned[29] = own('p0');
  g.owned[37] = own('p1'); g.owned[39] = own('p0');
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(140, [39]), get: side(0, [27]) });
  assert.deepEqual(botAction(g, 'p1'), { type: 'acceptTrade', id: g.trades[0].id });
  // …but a cheap set for Boardwalk is not fair.
  g.trades = [];
  g.owned[1] = own('p1'); g.owned[3] = own('p0');
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(0, [3]), get: side(0, [37]) });
  assert.deepEqual(botAction(g, 'p1'), { type: 'rejectTrade', id: g.trades[0].id });
});

test('bot: proposes the swap that completes both sets', () => {
  const { g } = scripted(2);
  g.owned[26] = own('p0'); g.owned[27] = own('p1'); g.owned[29] = own('p0');
  g.owned[37] = own('p1'); g.owned[39] = own('p0');
  g.phase = 'done';
  const a = botAction(g, 'p0');
  assert.equal(a?.type, 'proposeTrade');
  if (a?.type !== 'proposeTrade') return;
  assert.deepEqual(a.get.spaces, [27]);
  assert.deepEqual(a.give.spaces, [39]);
  assert.equal(a.give.cash, 0, 'Boardwalk is dearer than Ventnor: no top-up');
});

test('bot: jail — out early (card first), sits tight late once the board is built up', () => {
  const { g } = scripted(2);
  const p = g.player('p0');
  p.inJail = true; p.position = 10;
  assert.deepEqual(botAction(g, 'p0'), { type: 'payJail' });
  p.jailCards = ['chance'];
  assert.deepEqual(botAction(g, 'p0'), { type: 'useJailCard' });
  // Late game: nearly everything owned and the opponent has houses.
  g.spaces.forEach((s, i) => { if (s.price && i !== 1 && i !== 3) g.owned[i] = own('p1'); });
  g.owned[37].houses = 3; g.owned[39].houses = 3;
  assert.deepEqual(botAction(g, 'p0'), { type: 'roll' });
  // …unless "no rent in jail" is on and it has rent to collect.
  g.owned[1] = own('p0');
  (g.rules as { noRentInJail: boolean }).noRentInJail = true;
  assert.deepEqual(botAction(g, 'p0'), { type: 'useJailCard' });
});

test('bot: resigns at once when even selling everything cannot cover a debt; otherwise raises it', () => {
  const { g } = scripted(2);
  g.owned[1] = own('p0');
  g.player('p0').cash = 10;
  g.debts.push({ from: 'p0', to: 'p1', amount: 5000, reason: 'test' });
  assert.deepEqual(botAction(g, 'p0'), { type: 'bankrupt' });
  g.debts[0].amount = 30;
  assert.deepEqual(botAction(g, 'p0'), { type: 'mortgage', space: 1 });
});

test('bot: in a housing shortage, frees houses from its weakest set for its strongest', () => {
  const { g } = scripted(2);
  // p0: browns with 2 houses each, dark blues with 2 each; the bank is out.
  g.owned[1] = own('p0', 2); g.owned[3] = own('p0', 2);
  g.owned[37] = own('p0', 2); g.owned[39] = own('p0', 2);
  g.housesLeft = 0;
  g.player('p0').cash = 5000;
  g.phase = 'done';
  assert.deepEqual(botAction(g, 'p0'), { type: 'sell', space: 1 }, 'a brown house, not a dark blue one');
  g.apply('p0', { type: 'sell', space: 1 });
  assert.deepEqual(botAction(g, 'p0'), { type: 'build', space: 39 }, 'the freed house goes to the stronger set');
});

test('time limit: equal net worth keeps seat order; the richer later seat still wins', () => {
  const { g, tick } = scripted(3, { timeLimitMin: 30, turnSeconds: 0 });
  // p1 holds Boardwalk (400) and 1100 cash: worth 1500 like p0; p2 is worth 1501.
  g.owned[39] = { owner: 'p1', houses: 0, mortgaged: false };
  g.player('p1').cash = 1100;
  g.player('p2').cash = 1501;
  tick(30 * 60_000);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.standings().map(x => x.id), ['p2', 'p0', 'p1'], 'net worth first, ties by seat');
  assert.equal(g.winner, 'p2');
  assert.match(g.log.at(-2)!.text, /P2 wins with the highest net worth/);
});

test('seeded bot games with every rule toggle finish and keep every invariant', () => {
  const st = simulate(120, 1);
  assert.equal(st.finished, st.games, `unfinished seeds: ${st.unfinished}`);
  assert.ok(st.trades > 0 && st.hotels > 0 && st.auctions > 0, JSON.stringify(st));
});

test('utilities: 10x only for owning every utility on the board (and there being two or more)', () => {
  const { g } = scripted(2, {}, 'speed');
  const ut = g.spaces.map((s, i) => (s.kind === 'utility' ? i : -1)).filter(i => i >= 0);
  assert.equal(ut.length, 1, 'Speedway has one utility');
  g.owned[ut[0]] = own('p0');
  assert.equal(g.rentFor(ut[0], {}, 7), 28, 'the only utility is still 4x');
  assert.equal(g.rentFor(ut[0], { utilityTenX: true }, 7), 70, 'the card still makes it 10x');

  const c = scripted(2).g;
  c.owned[12] = own('p0');
  assert.equal(c.rentFor(12, {}, 7), 28);
  c.owned[28] = own('p0');
  assert.equal(c.rentFor(12, {}, 7), 70);
  c.owned[28] = own('p1');
  assert.equal(c.rentFor(12, {}, 7), 28);
});
