// A present player who misses one turn must not be locked into folding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';
import { playerConnected, playerDisconnected } from '../src/presence.ts';

const noop = { broadcast: () => {}, chat: () => {}, event: () => {} };

function t2p(actionMs: number) {
  const t = new Table({
    name: 'Lag', sb: 5, bb: 10, maxSeats: 6,
    actionTimeMs: actionMs,
  }, noop as never);
  t.sit(0, { id: 'a', name: 'Ana', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'Bo', avatar: '🙂' }, 1000);
  return t;
}

test('one missed turn does not shrink a connected player\'s clock', t3 => {
  t3.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  playerConnected('a'); playerConnected('b');
  t3.after(() => { playerDisconnected('a'); playerDisconnected('b'); });
  const t = t2p(20_000);
  t.startHand();

  // Ana lets one turn go by — a lag spike, or thinking too long.
  const seat = t.hand!.actionSeat()!;
  const who = t.seats[seat]!.player.id;
  t3.mock.timers.tick(20_100);
  const flagged = t.seats[t.playerSeat(who)!]!;
  assert.equal(flagged.sittingOut, true, 'flagged away, as designed');

  // Their next turn must still carry the full clock, because they are here.
  while (t.hand && t.hand.actionSeat() !== t.playerSeat(who)) {
    const other = t.hand.actionSeat()!;
    const legal = t.hand.legalActions();
    t.applyAction(t.seats[other]!.player.id, legal?.canCheck ? 'check' : 'call');
  }
  if (t.hand && t.hand.actionSeat() === t.playerSeat(who)) {
    const left = (t.actionDeadline ?? 0) - Date.now();
    assert.ok(left > 5_000, `a connected player keeps a real clock, got ${left}ms`);
  }
  t.close();
});

test('a disconnected player still resolves in a blink', t3 => {
  t3.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  playerConnected('b');
  t3.after(() => { playerDisconnected('b'); });
  const t = t2p(20_000);
  t.startHand();
  // Ana never connects at all.
  const seat = t.hand!.actionSeat()!;
  const who = t.seats[seat]!.player.id;
  if (who === 'a') {
    t3.mock.timers.tick(20_100);
  } else {
    const legal = t.hand!.legalActions();
    t.applyAction('b', legal?.canCheck ? 'check' : 'call');
    t3.mock.timers.tick(20_100);
  }
  const ana = t.seats[t.playerSeat('a')!]!;
  assert.equal(ana.sittingOut, true);
  // Next turn for the absent player is scheduled fast, not on the full clock.
  while (t.hand && t.hand.actionSeat() !== t.playerSeat('a')) {
    const other = t.hand.actionSeat()!;
    const legal = t.hand.legalActions();
    t.applyAction(t.seats[other]!.player.id, legal?.canCheck ? 'check' : 'call');
  }
  if (t.hand && t.hand.actionSeat() === t.playerSeat('a')) {
    const left = (t.actionDeadline ?? 0) - Date.now();
    assert.ok(left <= 1_000, `an absent player folds fast, got ${left}ms`);
  }
  t.close();
});
