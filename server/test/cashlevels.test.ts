// Rising blinds on a cash table. A cash game normally holds one blind pair
// forever; when a host writes a schedule it has to behave like a tournament's
// — levels move on their own clock, and never inside a hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

const noop = { broadcast: () => {}, chat: () => {}, event: () => {} };

function cashTable(levels: { sb: number; bb: number; ante: number; minutes: number }[]) {
  return new Table({
    name: 'Rising', mode: 'cash', sb: 1, bb: 2, maxSeats: 6,
    cash: { minBuy: 100, maxBuy: 1000 }, levels,
  }, noop as never);
}

test('a schedule sets the opening blinds, not whatever was passed alongside it', () => {
  const t = cashTable([{ sb: 25, bb: 50, ante: 0, minutes: 10 }]);
  assert.equal(t.sb, 25);
  assert.equal(t.bb, 50);
  t.close();
});

test('the clock raises the blinds between hands', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = cashTable([
    { sb: 5, bb: 10, ante: 0, minutes: 1 },
    { sb: 10, bb: 20, ante: 2, minutes: 1 },
    { sb: 25, bb: 50, ante: 5, minutes: 0 },
  ]);
  assert.deepEqual([t.sb, t.bb, t.ante], [5, 10, 0]);

  t2.mock.timers.tick(60_000);
  assert.deepEqual([t.sb, t.bb, t.ante], [10, 20, 2], 'level two');

  t2.mock.timers.tick(60_000);
  assert.deepEqual([t.sb, t.bb, t.ante], [25, 50, 5], 'level three');

  // The last row has no minutes, so it plays for as long as the table is up.
  t2.mock.timers.tick(60 * 60_000);
  assert.deepEqual([t.sb, t.bb, t.ante], [25, 50, 5], 'the final level holds');
  t.close();
});

test('blinds never change inside a hand', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  // The action clock has to outlast the level clock here, or advancing time
  // would fold the hand out from under the test and the level would move
  // between hands — which is the correct behaviour, just not what is under
  // test. This keeps one hand genuinely live across the level change.
  const t = new Table({
    name: 'Rising', mode: 'cash', sb: 1, bb: 2, maxSeats: 6,
    cash: { minBuy: 100, maxBuy: 1000 },
    actionTimeMs: 10 * 60_000,
    levels: [
      { sb: 5, bb: 10, ante: 0, minutes: 1 },
      { sb: 50, bb: 100, ante: 0, minutes: 0 },
    ],
  }, noop as never);
  t.sit(0, { id: 'a', name: 'A', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'B', avatar: '🙂' }, 1000);
  t.startHand();
  assert.ok(t.hand, 'a hand is in progress');

  // The level comes due while the hand is live.
  t2.mock.timers.tick(60_000);
  assert.deepEqual([t.sb, t.bb], [5, 10], 'the live hand keeps the price it started at');

  // It takes effect at the next deal.
  t.hand = null;
  t.startHand();
  assert.deepEqual([t.sb, t.bb], [50, 100], 'the next hand is dealt at the new level');
  t.close();
});

test('with no schedule the blinds stay put', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const t = new Table({
    name: 'Fixed', mode: 'cash', sb: 5, bb: 10, maxSeats: 6,
    cash: { minBuy: 100, maxBuy: 1000 },
  }, noop as never);
  t2.mock.timers.tick(4 * 60 * 60_000);
  assert.deepEqual([t.sb, t.bb], [5, 10]);
  assert.equal(t.blindLevelInfo(), null, 'and the felt is told there is no schedule');
  t.close();
});
