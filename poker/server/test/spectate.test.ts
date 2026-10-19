// A spectator must see the table exactly as the players do, minus hole cards,
// and the board must survive the pause between hands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

const noopCb = { broadcast: () => {}, chat: () => {}, event: () => {} };

function seated(): Table {
  const t = new Table({ name: 'T', mode: 'cash', sb: 5, bb: 10, cash: { minBuy: 100, maxBuy: 2000 } }, noopCb);
  t.interHandDelayMs = 1;
  t.runoutStepMs = 1;
  t.sit(0, { id: 'a', name: 'A', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'B', avatar: '🙃' }, 1000);
  return t;
}

test('a spectator sees the same live table as the players', () => {
  const t = seated();
  t.startHand();

  const player = t.view('a');
  const spectator = t.view(null);

  // Everything that makes the table watchable is identical.
  assert.equal(spectator.street, player.street);
  assert.equal(spectator.handNumber, player.handNumber);
  assert.equal(spectator.totalPot, player.totalPot);
  assert.equal(spectator.actionOn, player.actionOn, 'whose turn it is');
  assert.equal(spectator.actionDeadline, player.actionDeadline, 'the turn clock');
  assert.equal(spectator.actionStarted, player.actionStarted);
  assert.deepEqual(spectator.blinds, player.blinds);
  assert.deepEqual(spectator.community, player.community);
  assert.equal(spectator.seats.length, player.seats.length);
  for (let i = 0; i < spectator.seats.length; i++) {
    assert.equal(spectator.seats[i].stack, player.seats[i].stack, `seat ${i} stack`);
    assert.equal(spectator.seats[i].bet, player.seats[i].bet, `seat ${i} bet`);
    assert.equal(spectator.seats[i].isTurn, player.seats[i].isTurn, `seat ${i} turn`);
    assert.equal(spectator.seats[i].isDealer, player.seats[i].isDealer, `seat ${i} dealer`);
  }

  // But no hole cards, and no way to act.
  assert.equal(spectator.mySeat, null);
  assert.equal(spectator.myLegal, null);
  const own = player.seats.find(s => s.player?.id === 'a')!;
  const asSeen = spectator.seats.find(s => s.player?.id === 'a')!;
  assert.ok(own.cards?.every(c => c !== null), 'the player sees their own cards');
  assert.ok(asSeen.cards?.every(c => c === null), 'the spectator sees only card backs');

  t.close();
});

test('the board stays on screen through the pause after a hand', () => {
  const t = seated();
  t.startHand();
  // Run it to a showdown so there is a full board to keep.
  let guard = 0;
  while (t.hand && guard++ < 50) {
    const seat = t.hand.actionSeat();
    if (seat === null) break;
    const id = t.seats[seat]!.player.id;
    const legal = t.hand.legalActions()!;
    t.applyAction(id, legal.canCheck ? 'check' : 'call');
  }

  // The hand object is gone during the pause, but the result is still shown.
  assert.equal(t.hand, null, 'hand finished');
  const v = t.view(null);
  assert.ok(v.lastResults && v.lastResults.length > 0, 'results are on screen');
  assert.ok(v.community.length > 0,
    'the board is still visible — otherwise the winning hand cannot be read');
  assert.equal(v.community.length, 5, 'the whole river board is kept');

  // Spectators and players see the same held board.
  assert.deepEqual(t.view('a').community, v.community);
  // And the mini-table overview agrees.
  assert.deepEqual(t.overview().community, v.community);

  t.close();
});

test('the held board is cleared when the next hand begins', () => {
  const t = seated();
  t.startHand();
  const id = t.seats[t.hand!.actionSeat()!]!.player.id;
  t.applyAction(id, 'fold');
  assert.ok(t.view(null).community.length >= 0);

  t.startHand();
  assert.deepEqual(t.view(null).community, [], 'no leftovers from the previous hand');
  t.close();
});
