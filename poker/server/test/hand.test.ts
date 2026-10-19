import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldemHand } from '../src/engine/hand.ts';
import { freshDeck, parseCards, cardStr } from '../src/engine/cards.ts';
import type { CardT } from '../../shared/types.ts';

// Build a deck that deals specific hole cards / board.
// Deal order: players in seat order get 2 cards each (pop from end), then board.
function riggedDeck(holes: string[], board: string): CardT[] {
  const used = new Set<string>();
  const cards: CardT[] = [];
  for (const h of holes) for (const c of parseCards(h)) { cards.push(c); used.add(cardStr(c)); }
  const boardCards = parseCards(board);
  for (const c of boardCards) used.add(cardStr(c));

  const deck = freshDeck().filter(c => !used.has(cardStr(c)));
  // deck.pop() deals from the end: place hole cards at the end in reverse deal order.
  // Hand pops 2 cards per player in seats order, then 3 flop + 1 turn + 1 river.
  const dealSequence: CardT[] = [...cards, ...boardCards];
  return [...deck, ...dealSequence.reverse()];
}

const P = (seat: number, stack: number) => ({ seat, id: `p${seat}`, stack });

test('blinds are posted and preflop action starts UTG', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0,
  });
  assert.equal(h.seats[1].totalCommitted, 5); // SB
  assert.equal(h.seats[2].totalCommitted, 10); // BB
  assert.equal(h.actionSeat(), 0); // UTG = button in 3-handed
});

test('walk: everyone folds, BB wins blinds', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0,
  });
  h.act(0, 'fold');
  h.act(1, 'fold');
  assert.ok(h.finished);
  assert.equal(h.result!.awards[0].seat, 2);
  assert.equal(h.result!.awards[0].amount, 15);
  assert.equal(h.seats[2].stack, 1005); // 1000 - 10 + 15
});

test('check down to showdown, best hand wins', () => {
  const deck = riggedDeck(
    ['As Ah', 'Kd Kc'], // seat0 aces, seat1 kings
    '2c 7d 9h Js 3s',
  );
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0, deck,
  });
  // HU: button (0) posts SB, acts first preflop.
  h.act(0, 'call');
  h.act(1, 'check');
  // Postflop: non-button acts first.
  for (let street = 0; street < 3; street++) {
    h.act(1, 'check');
    h.act(0, 'check');
  }
  assert.ok(h.finished);
  assert.equal(h.result!.wentToShowdown, true);
  assert.equal(h.result!.awards.length, 1);
  assert.equal(h.result!.awards[0].seat, 0);
  assert.equal(h.result!.awards[0].amount, 20);
});

test('side pots: short stack all-in wins main only', () => {
  const deck = riggedDeck(
    ['As Ah', 'Kd Kc', 'Qs Qc'], // seat0 short with aces, seat1 kings, seat2 queens
    '2c 7d 9h Js 3s',
  );
  const h = new HoldemHand({
    players: [P(0, 100), P(1, 1000), P(2, 1000)],
    buttonSeat: 2, sb: 5, bb: 10, ante: 0, deck,
  });
  // seat0=SB(5), seat1=BB(10), action on seat2 (UTG/button 3-handed... button is 2, SB=0, BB=1, first = 2)
  assert.equal(h.actionSeat(), 2);
  h.act(2, 'raise', 300);
  h.act(0, 'allin'); // 100 total
  h.act(1, 'call'); // calls 300
  // seat2 already matched; betting closed. Runout pending (seat0 all-in, but 1&2 can still bet).
  // Actually 1 & 2 still active -> flop betting continues.
  // Flop: action on seat 0? no - all-in. Next active after button: seat 1.
  while (!h.finished) {
    const seat = h.actionSeat();
    if (seat !== null) {
      h.act(seat, 'check');
    } else if (h.runoutPending) {
      h.dealRunoutStep();
    } else {
      break;
    }
  }
  assert.ok(h.finished);
  const awards = new Map(h.result!.awards.map(a => [a.seat, a.amount]));
  // Main pot: 100*3 = 300 to seat0 (aces).
  // Side pot: 200*2 = 400 to seat1 (kings beat queens).
  assert.equal(awards.get(0), 300);
  assert.equal(awards.get(1), 400);
  assert.equal(h.seats[0].stack, 300);
  assert.equal(h.seats[1].stack, 1100);
  assert.equal(h.seats[2].stack, 700);
});

test('split pot divides evenly with odd chip to left of button', () => {
  const deck = riggedDeck(
    ['2h 3d', '4s 5c'], // both play the board
    'Ac Kd Qh Js Tc',
  );
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0, deck,
  });
  h.act(0, 'call');
  h.act(1, 'check');
  for (let s = 0; s < 3; s++) { h.act(1, 'check'); h.act(0, 'check'); }
  const awards = new Map(h.result!.awards.map(a => [a.seat, a.amount]));
  assert.equal((awards.get(0) ?? 0) + (awards.get(1) ?? 0), 20);
  assert.equal(awards.get(0), 10);
  assert.equal(awards.get(1), 10);
});

test('min-raise enforcement', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0,
  });
  // UTG raise to 25 (min is 20).
  h.act(0, 'raise', 25);
  // Next: raise must be at least 25 + 15 = 40.
  assert.throws(() => h.act(1, 'raise', 30));
  h.act(1, 'raise', 40);
  assert.equal(h.currentBet, 40);
});

test('short all-in does not reopen betting', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 45)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0,
  });
  h.act(0, 'raise', 30);
  h.act(1, 'call');
  // seat2 (BB, 45 total) goes all-in for 45 — a raise of 15, below min raise (20).
  h.act(2, 'allin');
  assert.equal(h.currentBet, 45);
  // seat0 may call but NOT raise (action not reopened).
  const legal0 = h.legalActions()!;
  assert.equal(legal0.seat, 0);
  h.act(0, 'call');
  const legal1 = h.legalActions()!;
  assert.equal(legal1.seat, 1);
  h.act(1, 'call');
  // Betting round complete → flop dealt, action on seat 1.
  assert.equal(h.street, 'flop');
});

test('antes go to the pot', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 1000)],
    buttonSeat: 0, sb: 50, bb: 100, ante: 10,
  });
  assert.equal(h.totalPot, 50 + 100 + 30);
  h.act(0, 'fold');
  h.act(1, 'fold');
  assert.equal(h.result!.awards[0].amount, 180);
});

test('all-in preflop runs out the full board', () => {
  const deck = riggedDeck(['As Ah', 'Kd Kc'], '2c 7d 9h Js 3s');
  const h = new HoldemHand({
    players: [P(0, 500), P(1, 500)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0, deck,
  });
  h.act(0, 'allin');
  h.act(1, 'call');
  assert.ok(h.runoutPending);
  let guard = 0;
  while (!h.finished && guard++ < 10) h.dealRunoutStep();
  assert.ok(h.finished);
  assert.equal(h.board.length, 5);
  assert.equal(h.seats[0].stack, 1000);
  assert.equal(h.seats[1].stack, 0);
});

test('BB gets option after limps', () => {
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 1000)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0,
  });
  h.act(0, 'call');
  h.act(1, 'call'); // SB completes
  // BB should have option to check or raise.
  assert.equal(h.actionSeat(), 2);
  const legal = h.legalActions()!;
  assert.ok(legal.canCheck);
  assert.ok(legal.canRaise);
  h.act(2, 'raise', 30);
  assert.equal(h.actionSeat(), 0);
});
