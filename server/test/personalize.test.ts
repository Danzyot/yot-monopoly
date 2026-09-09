// The broadcast fast path (shared view + per-viewer patch) must be
// indistinguishable from building the full view per viewer. If these two ever
// diverge, players see wrong state — so every interesting table phase is
// checked field for field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

const noopCb = { broadcast: () => {}, chat: () => {}, event: () => {} };

function makeTable(): Table {
  const t = new Table(
    { name: 'T', mode: 'cash', sb: 5, bb: 10, cash: { minBuy: 100, maxBuy: 2000 }, rabbitHunting: true },
    noopCb,
  );
  t.interHandDelayMs = 1;
  t.runoutStepMs = 1;
  t.sit(0, { id: 'a', name: 'A', avatar: '🙂' }, 1000);
  t.sit(2, { id: 'b', name: 'B', avatar: '🙃' }, 1000);
  t.sit(5, { id: 'c', name: 'C', avatar: '😐' }, 1000);
  return t;
}

function assertSame(t: Table, label: string) {
  const base = t.view(null);
  for (const viewer of ['a', 'b', 'c', 'ghost', null]) {
    assert.deepEqual(
      t.personalize(base, viewer),
      t.view(viewer),
      `${label}: personalize(${viewer}) must equal view(${viewer})`,
    );
  }
}

test('personalize matches view in every table phase', () => {
  const t = makeTable();
  assertSame(t, 'before any hand');

  t.startHand();
  assertSame(t, 'live hand, preflop');

  // Someone folds — their own view must still show their (dead) cards.
  const seat = t.hand!.actionSeat()!;
  t.applyAction(t.seats[seat]!.player.id, 'fold');
  assertSame(t, 'live hand after a fold');

  // Play to completion (checks/calls reach showdown or a fold-out).
  let guard = 0;
  while (t.hand && guard++ < 60) {
    const s = t.hand.actionSeat();
    if (s === null) break;
    const legal = t.hand.legalActions()!;
    t.applyAction(t.seats[s]!.player.id, legal.canCheck ? 'check' : 'call');
  }
  assertSame(t, 'post-hand pause (results showing)');

  // Voluntary reveal during the pause changes what everyone sees.
  const v = t.view('a');
  if (v.myCanReveal) {
    t.applyReveal('a', 'first');
    assertSame(t, 'after a partial voluntary reveal');
  }
  if (t.view(null).rabbitAvailable) {
    t.showRabbit();
    assertSame(t, 'after a rabbit hunt');
  }

  t.close();
});

test('personalize never leaks one player\'s cards to another', () => {
  const t = makeTable();
  t.startHand();
  const base = t.view(null);
  const forA = t.personalize(base, 'a');
  const forB = t.personalize(base, 'b');

  const aOwn = forA.seats[0].cards;
  assert.ok(aOwn && aOwn.every(c => c !== null), 'A sees their own cards');
  const aSeenByB = forB.seats[0].cards;
  assert.ok(!aSeenByB || aSeenByB.every(c => c === null), 'B sees only backs for A');
  // And the shared base itself was not mutated by personalization.
  assert.ok(!base.seats[0].cards || base.seats[0].cards.every(c => c === null),
    'the shared view still holds no hole cards');
  t.close();
});
