// Pausing stops play. It used to set a flag that only blocked the NEXT hand,
// so a director who paused mid-event watched every table keep playing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

const noop = { broadcast: () => {}, chat: () => {}, event: () => {} };

function heads(actionMs = 20_000) {
  const t = new Table({
    name: 'Freeze', sb: 5, bb: 10, maxSeats: 6, actionTimeMs: actionMs,
  }, noop as never);
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  return t;
}

test('a hand in progress freezes instead of playing on', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = heads();
  t.startHand();
  const seat = t.hand!.actionSeat()!;
  const handNo = t.handNumber;

  t.pause();
  // Long past the action clock: nothing must resolve itself.
  t2.mock.timers.tick(60_000);
  assert.ok(t.hand, 'the hand is still there');
  assert.equal(t.hand!.actionSeat(), seat, 'and still on the same player');
  assert.equal(t.handNumber, handNo, 'no new hand was dealt');
  t.close();
});

test('nobody can act while paused', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = heads();
  t.startHand();
  const seat = t.hand!.actionSeat()!;
  const who = t.seats[seat]!.player.id;
  t.pause();
  assert.throws(() => t.applyAction(who, 'call'), /paused/i);
  t.close();
});

test('resuming hands back the time that was left', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = heads(20_000);
  t.startHand();
  const seat = t.hand!.actionSeat()!;

  t2.mock.timers.tick(5_000);       // 15s left
  t.pause();
  t2.mock.timers.tick(120_000);     // two minutes of pause
  t.resume();

  const left = (t.actionDeadline ?? 0) - Date.now();
  assert.ok(left > 13_000 && left <= 15_500, `about fifteen seconds back, got ${left}ms`);
  assert.equal(t.hand!.actionSeat(), seat, 'same player still to act');

  // And the clock runs again from there.
  t2.mock.timers.tick(16_000);
  assert.ok(!t.hand || t.hand.actionSeat() !== seat, 'their turn resolved once time ran out');
  t.close();
});

test('resuming between hands starts the next one', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = heads();
  t.pause();
  t2.mock.timers.tick(30_000);
  assert.equal(t.hand, null, 'nothing dealt while paused');
  t.resume();
  t2.mock.timers.tick(3_000);
  assert.ok(t.hand, 'play restarts on resume');
  t.close();
});
