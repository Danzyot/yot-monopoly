// Rabbit hunting: the board that never came, revealed only when asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

const noopCb = { broadcast: () => {}, chat: () => {}, event: () => {} };

function makeTable(rabbitHunting: boolean): Table {
  const t = new Table(
    { name: 'T', sb: 5, bb: 10, rabbitHunting },
    noopCb,
  );
  t.interHandDelayMs = 1;
  t.runoutStepMs = 1;
  t.sit(0, { id: 'a', name: 'A', avatar: '🙂' }, 1000);
  t.sit(1, { id: 'b', name: 'B', avatar: '🙃' }, 1000);
  return t;
}

// End the hand pre-river by folding, so there is a board left to hunt.
function foldItOut(t: Table) {
  t.startHand();
  const seat = t.hand!.actionSeat()!;
  const id = t.seats[seat]!.player.id;
  t.applyAction(id, 'fold');
}

test('a hand that ends early leaves a rabbit board, hidden until asked for', () => {
  const t = makeTable(true);
  foldItOut(t);

  const before = t.view('a');
  assert.equal(before.rabbitAvailable, true, 'offered once the hand is over');
  assert.equal(before.rabbit, null, 'not revealed until someone asks');

  t.showRabbit();

  const after = t.view('a');
  assert.equal(after.rabbit?.length, 5, 'a folded preflop hand leaves the whole board');
  assert.equal(after.rabbitAvailable, false, 'no longer on offer once shown');
  // Everyone at the table sees it — rabbit hunting is public.
  assert.deepEqual(t.view('b').rabbit, after.rabbit);
  t.close();
});

test('rabbit cards are real, distinct cards and never duplicate the board', () => {
  const t = makeTable(true);
  foldItOut(t);
  t.showRabbit();
  const v = t.view('a');
  const key = (c: { r: number; s: number }) => `${c.r}-${c.s}`;
  const all = [...v.community, ...v.rabbit!];
  assert.equal(new Set(all.map(key)).size, all.length, 'no card appears twice');
  for (const c of v.rabbit!) {
    assert.ok(c.r >= 2 && c.r <= 14, 'valid rank');
    assert.ok(c.s >= 0 && c.s <= 3, 'valid suit');
  }
  t.close();
});

test('rabbit hunting stays off when the table disables it', () => {
  const t = makeTable(false);
  foldItOut(t);
  const v = t.view('a');
  assert.equal(v.rabbitAvailable, false);
  assert.equal(v.rabbit, null);
  t.showRabbit();
  assert.equal(t.view('a').rabbit, null, 'asking does nothing');
  t.close();
});

test('the rabbit board is cleared when the next hand starts', () => {
  const t = makeTable(true);
  foldItOut(t);
  t.showRabbit();
  assert.ok(t.view('a').rabbit);

  t.startHand();
  const v = t.view('a');
  assert.equal(v.rabbit, null, 'no leftovers from the previous hand');
  assert.equal(v.rabbitAvailable, false, 'not offered mid-hand');
  t.close();
});
