// Running out of chips at a cash table.
//
// A tournament eliminates you; a cash game has to offer a way back in and,
// failing that, release the seat. Neither happened: a busted player kept
// their seat on zero chips forever, and since a table needs two players WITH
// chips to deal, a table where everyone had gone broke simply froze.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table, type CashBustInfo } from '../src/engine/table.ts';

function cashTable(onBust?: (i: CashBustInfo) => void) {
  return new Table({
    name: 'Busted', mode: 'cash', sb: 5, bb: 10, maxSeats: 6,
    cash: { minBuy: 200, maxBuy: 2000 },
  }, {
    broadcast: () => {}, chat: () => {}, event: () => {},
    cashBust: (_t: unknown, info: CashBustInfo) => onBust?.(info),
  } as never);
}

// Drop a seat to zero the way a lost hand does, then run the table's own
// post-hand path over it.
function bust(t: InstanceType<typeof Table>, playerId: string) {
  const idx = t.playerSeat(playerId)!;
  t.seats[idx]!.stack = 0;
  (t as never as { handleCashBust: (s: unknown) => void }).handleCashBust(t.seats[idx]);
}

test('a busted player is told where their session finished', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const seen: CashBustInfo[] = [];
  const t = cashTable(i => seen.push(i));
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  // Ana loses her stack to Bo.
  t.seats[1]!.stack = 2000;
  bust(t, 'a');

  assert.equal(seen.length, 1, 'she is told');
  const info = seen[0];
  assert.equal(info.name, 'Ana');
  assert.equal(info.buyIn, 1000);
  assert.equal(info.net, -1000, 'down her whole buy-in');
  assert.equal(info.of, 2, 'ranked against everyone at the table');
  assert.equal(info.rank, 2, 'and she is last of the two');
  assert.ok(info.minBuy === 200 && info.maxBuy === 2000, 'with the terms to come back');
  t.close();
});

test('the seat is released when the offer is ignored', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = cashTable();
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  bust(t, 'a');
  assert.ok(t.playerSeat('a') !== null, 'the seat is held while they decide');

  t2.mock.timers.tick(95_000);
  assert.equal(t.playerSeat('a'), null, 'and released once the window closes');
  // Their session is settled rather than forgotten.
  const row = t.ledger().find(e => e.playerId === 'a');
  assert.ok(row, 'they are still on the ledger');
  assert.equal(row!.net, -1000);
  t.close();
});

test('buying back in keeps the seat', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = cashTable();
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  bust(t, 'a');
  t.topUp('a', 500);

  t2.mock.timers.tick(95_000);
  assert.ok(t.playerSeat('a') !== null, 'still seated long after the window would have closed');
  assert.equal(t.seats[t.playerSeat('a')!]!.stack, 500);
  t.close();
});

test('a table of broke players can deal again once seats are freed', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = cashTable();
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  t.sit(2, { id: 'c', name: 'Cy', avatar: '🙂' }, 3000);
  // Two of the three go broke — the shape that froze the table.
  bust(t, 'a');
  bust(t, 'b');
  assert.equal(t.activeSeatIdxs().length, 1, 'only one player can act');

  t2.mock.timers.tick(95_000);
  assert.equal(t.playerSeat('a'), null);
  assert.equal(t.playerSeat('b'), null);
  // A new player can now take a seat and the game continues.
  t.sit(0, { id: 'd', name: 'Dee', avatar: '🙂' }, 1000);
  assert.equal(t.activeSeatIdxs().length, 2, 'the table can deal again');
  t.close();
});
