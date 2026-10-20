// Reversing a turn has to put the table back *exactly*, not approximately:
// stacks, the pot, whose turn it is, the board, and — the one that is easy to
// miss — the order of the undealt deck, or the next card after an undo would
// differ from the one that was coming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';

// The table arms real timers; handing it the test context means every one of
// them is cleared when the test ends, instead of holding the process open.
function makeTable(ctx: { after: (fn: () => void) => void }): Table {
  const t = new Table(
    { name: 'Undo', sb: 25, bb: 50, maxSeats: 6 },
    { broadcast: () => {}, chat: () => {}, event: () => {} },
  );
  t.sit(0, { id: 'a', name: 'Alice', avatar: '🙂' }, 5_000);
  t.sit(1, { id: 'b', name: 'Bob', avatar: '😎' }, 5_000);
  t.sit(2, { id: 'c', name: 'Cara', avatar: '🐱' }, 5_000);
  ctx.after(() => t.close());
  return t;
}

// Everything a reversal is supposed to restore, in one comparable shape.
function snapshot(t: Table) {
  const h = t.hand!;
  return {
    street: h.street,
    board: h.board.map(c => `${c.r}${c.s}`).join(' '),
    deck: h.deck.map(c => `${c.r}${c.s}`).join(' '),
    pot: h.totalPot,
    currentBet: h.currentBet,
    actionSeat: h.actionSeat(),
    seats: h.seats.map(s => `${s.seat}:${s.stack}:${s.committed}:${s.folded}:${s.allIn}:${s.lastAction}`).join('|'),
  };
}

function startHand(t: Table) {
  // The table deals on a timer; drive it directly so the test is not timing
  // dependent.
  (t as unknown as { startHand: () => void }).startHand();
}

test('reversing a call puts the table back exactly as it was', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  const before = snapshot(t);
  const actor = t.seats[t.hand!.actionSeat()!]!.player.id;

  t.applyAction(actor, 'call');
  assert.notDeepEqual(snapshot(t), before, 'the call actually changed something');

  t.reverseTurn();
  assert.deepEqual(snapshot(t), before, 'and the reversal put every part of it back');
});

test('the undealt deck survives, so the next card is the one that was coming', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  const deckBefore = t.hand!.deck.map(c => `${c.r}${c.s}`).join(' ');
  const actor = () => t.seats[t.hand!.actionSeat()!]!.player.id;

  t.applyAction(actor(), 'call');
  t.reverseTurn();
  assert.equal(t.hand!.deck.map(c => `${c.r}${c.s}`).join(' '), deckBefore);
});

test('a fold can be taken back — the player is live again', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  const seatIdx = t.hand!.actionSeat()!;
  const actor = t.seats[seatIdx]!.player.id;

  t.applyAction(actor, 'fold');
  assert.equal(t.hand!.seats.find(s => s.seat === seatIdx)!.folded, true);

  t.reverseTurn();
  assert.equal(t.hand!.seats.find(s => s.seat === seatIdx)!.folded, false, 'back in the hand');
  assert.equal(t.hand!.actionSeat(), seatIdx, 'and it is their decision again');
});

test('several turns can be walked back one at a time', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  const states = [snapshot(t)];
  for (let i = 0; i < 3; i++) {
    t.applyAction(t.seats[t.hand!.actionSeat()!]!.player.id, 'call');
    states.push(snapshot(t));
  }
  // Unwind back to the start, checking each step lands on the state it should.
  for (let i = states.length - 2; i >= 0; i--) {
    t.reverseTurn();
    assert.deepEqual(snapshot(t), states[i], `back to state ${i}`);
  }
});

test('reversing refuses when there is nothing of this hand to undo', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  assert.equal(t.canReverseTurn(), false, 'no action taken yet');
  assert.throws(() => t.reverseTurn(), /no action has been taken/);

  t.applyAction(t.seats[t.hand!.actionSeat()!]!.player.id, 'call');
  assert.equal(t.canReverseTurn(), true);
  t.reverseTurn();
  assert.equal(t.canReverseTurn(), false, 'and the stack is empty again');
});

test('a reversal is written to the session log', ctx => {
  const t = makeTable(ctx);
  startHand(t);
  t.applyAction(t.seats[t.hand!.actionSeat()!]!.player.id, 'call');
  t.reverseTurn();
  assert.ok(
    t.eventLog.some(e => /reversed the last turn/.test(e.text)),
    'moving the game backwards is never silent',
  );
});

test('stack edits are bounded, logged, and refused mid-hand', ctx => {
  const t = makeTable(ctx);
  const r = t.setStack('a', 7_500, 'Danz');
  assert.deepEqual(r, { name: 'Alice', from: 5_000, to: 7_500 });
  assert.equal(t.seats[0]!.stack, 7_500);
  assert.ok(t.eventLog.some(e => /adjusted Alice's stack: 5000 → 7500/.test(e.text)));

  assert.equal(t.setStack('a', -100, 'Danz').to, 0, 'never negative');

  startHand(t);
  assert.throws(() => t.setStack('b', 1, 'Danz'), /live hand/, 'not while they are in a hand');
  assert.throws(() => t.setStack('nobody', 1, 'Danz'), /not seated/);
});
