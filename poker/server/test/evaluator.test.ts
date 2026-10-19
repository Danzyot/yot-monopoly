import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/engine/cards.ts';
import { CAT, categoryOf, evaluate5, evaluate7, handName } from '../src/engine/evaluator.ts';

function score5(s: string) { return evaluate5(parseCards(s)); }
function score7(s: string) { return evaluate7(parseCards(s)); }

test('categories rank correctly', () => {
  const royal = score5('As Ks Qs Js Ts');
  const sf = score5('9h 8h 7h 6h 5h');
  const quads = score5('Ac Ad Ah As Kd');
  const boat = score5('Kc Kd Kh 2s 2d');
  const flush = score5('Ah Jh 9h 6h 3h');
  const straight = score5('9c 8d 7h 6s 5c');
  const trips = score5('Qc Qd Qh 9s 2d');
  const twoPair = score5('Jc Jd 8h 8s 3d');
  const pair = score5('Tc Td 9h 5s 2d');
  const high = score5('Ac Jd 9h 6s 3d');

  const ordered = [royal, sf, quads, boat, flush, straight, trips, twoPair, pair, high];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(ordered[i] > ordered[i + 1], `entry ${i} should beat entry ${i + 1}`);
  }
  assert.equal(categoryOf(royal), CAT.STRAIGHT_FLUSH);
  assert.equal(handName(royal), 'Royal Flush');
});

test('wheel straight is five-high', () => {
  const wheel = score5('Ah 2c 3d 4s 5h');
  const sixHigh = score5('2c 3d 4s 5h 6d');
  assert.equal(categoryOf(wheel), CAT.STRAIGHT);
  assert.ok(sixHigh > wheel);
});

test('kickers break ties', () => {
  const a = score5('Ac Ad Kh 9s 2d'); // AA K92
  const b = score5('Ah As Qh 9c 2c'); // AA Q92
  assert.ok(a > b);
});

test('evaluate7 finds best five', () => {
  // Board pairs into a boat that beats a flush.
  const s = score7('Ah Kh Qh 7c 7d 7h 2h'); // has 777 + flush possibilities
  assert.equal(categoryOf(s), CAT.FLUSH); // Ah Kh Qh 7h 2h flush beats trips
  const boat = score7('7c 7d 7h Kc Kd 2s 3s');
  assert.equal(categoryOf(boat), CAT.FULL_HOUSE);
});

test('split pot hands evaluate equal', () => {
  // Both play the board.
  const board = 'Ac Kd Qh Js Tc';
  const a = evaluate7(parseCards(`2h 3d ${board}`));
  const b = evaluate7(parseCards(`4s 5c ${board}`));
  assert.equal(a, b);
});
