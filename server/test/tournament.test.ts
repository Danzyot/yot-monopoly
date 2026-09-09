import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayouts, paidPlaces } from '../src/tournament/payouts.ts';
import { generateStructure } from '../src/tournament/blinds.ts';

test('payouts sum exactly to the prize pool', () => {
  for (const entries of [2, 5, 9, 27, 100, 500]) {
    const pool = entries * 100;
    const payouts = computePayouts(entries, pool);
    const total = payouts.reduce((a, p) => a + p.amount, 0);
    assert.equal(total, pool, `entries=${entries}`);
    assert.ok(payouts[0].amount >= (payouts[1]?.amount ?? 0), 'first place biggest');
  }
});

test('paid places scale with field size', () => {
  assert.equal(paidPlaces(2), 1);
  assert.equal(paidPlaces(9), 3);
  assert.ok(paidPlaces(100) >= 10);
  assert.ok(paidPlaces(500) <= 100);
});

test('blind structure grows monotonically with antes from level 4', () => {
  for (const kind of ['turbo', 'regular', 'deep'] as const) {
    const levels = generateStructure(kind, 30);
    assert.equal(levels.length, 30);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i].bb > levels[i - 1].bb, `${kind} level ${i} bb should grow`);
      assert.ok(levels[i].sb <= levels[i].bb, 'sb <= bb');
    }
    assert.equal(levels[0].ante, 0);
    assert.ok(levels[5].ante > 0, 'antes after level 4');
  }
});
