// "Last card!": the call, the catch window and its edges. A player who plays
// down to one card must call before the next player acts; until then (after a
// short grace to call) anyone else may catch them for a 2-card penalty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAST_CARD_GRACE_MS } from '../src/cards/game.ts';
import { assertConserved, assertRefused, putOnTop, setHand, table } from './cardsHelpers.ts';

const catchP0 = { type: 'catch', target: 'p0' } as const;

test('calling with the play: safe at once, and the call is on the record', () => {
  const { g, act, play, tick, now } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  const t = now();
  play('p0', 'g1', { callLastCard: true });
  assert.deepEqual(g.view('p1').oneCard, [{ player: 'p0', since: t, calledAt: t, closedAt: null, catchable: false, catchFrom: t + LAST_CARD_GRACE_MS }]);
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'call']);
  assert.equal(g.log.at(-1)!.text, 'P0: "Last card!"');
  tick(LAST_CARD_GRACE_MS);
  assertRefused(g, () => act('p2', catchP0), /already called/);
  assert.deepEqual(g.view('p2').you!.canCatch, []);
});

test('forgetting to call: caught after the grace, the penalty is 2 cards', () => {
  const { g, act, play, tick, now } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  play('p0', 'g1');
  const oc = g.view('p2').oneCard[0];
  assert.deepEqual(oc, { player: 'p0', since: now(), calledAt: null, closedAt: null, catchable: true, catchFrom: now() + LAST_CARD_GRACE_MS });
  assert.deepEqual(g.view('p2').you!.canCatch, [], 'still inside the grace');
  assertRefused(g, () => act('p2', catchP0), /Too soon/);
  tick(LAST_CARD_GRACE_MS - 1);
  assertRefused(g, () => act('p2', catchP0), /Too soon/);
  tick(1);
  assert.deepEqual(g.view('p2').you!.canCatch, ['p0']);
  act('p2', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
  assert.equal(g.current.id, 'p1', 'a catch is not a turn');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type === 'draw' ? `draw:${s.reason}:${s.count}` : s.type), ['catch', 'draw:caught:2']);
  assert.equal(g.lastPlay!.player, 'p2');
  assert.ok(g.log.some(l => l.text === 'P2 caught P0 without a "Last card!" call — P0 draws 2.' && l.amount === 2 && l.reason === 'caught'));
  assert.deepEqual(g.view('p1').oneCard, []);
  assertRefused(g, () => act('p1', catchP0), /not down to one card/);
  assertConserved(g);
});

test('the next player may catch too, before they take their turn', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  play('p0', 'g1');
  tick(LAST_CARD_GRACE_MS);
  act('p1', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
  assert.equal(g.current.id, 'p1');
  assert.equal(g.phase, 'play');
});

test('a late call inside the window still counts', () => {
  const { g, act, play, tick, now } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  play('p0', 'g1');
  tick(LAST_CARD_GRACE_MS + 400);
  act('p0', { type: 'callLastCard' });
  assert.equal(g.view().oneCard[0].calledAt, now());
  assert.equal(g.view().oneCard[0].catchable, false);
  assertRefused(g, () => act('p2', catchP0), /already called/);
  assertRefused(g, () => act('p0', { type: 'callLastCard' }), /already called/);
});

test('the window closes once the next player acts: too late to catch', () => {
  for (const nextMove of ['play', 'draw'] as const) {
    const { g, act, play, tick, now } = table(3);
    setHand(g, 'p0', ['g1', 'g2']);
    setHand(g, 'p1', ['g3', 'g4']);
    play('p0', 'g1');
    tick(LAST_CARD_GRACE_MS * 3);
    if (nextMove === 'play') play('p1', 'g3');
    else act('p1', { type: 'draw' });
    assertRefused(g, () => act('p2', catchP0), /Too late/);
    assert.equal(g.view().oneCard[0].catchable, false, nextMove);
    assert.equal(g.view().oneCard[0].calledAt, null);
    assert.equal(g.view().oneCard[0].closedAt, now(), 'closed the moment the next player acted');
  }
});

test('calling ahead with two cards counts for the play down to one', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  act('p0', { type: 'callLastCard' });
  assert.equal(g.view('p0').you!.preCalled, true);
  assert.equal(g.view('p0').you!.canCallLastCard, false);
  assertRefused(g, () => act('p0', { type: 'callLastCard' }), /already called/);
  play('p0', 'g1');
  assert.notEqual(g.view().oneCard[0].calledAt, null);
  tick(LAST_CARD_GRACE_MS);
  assertRefused(g, () => act('p2', catchP0), /already called/);
  // With three or more cards there is nothing to call.
  setHand(g, 'p1', ['g3', 'g4', 'g5']);
  assertRefused(g, () => act('p1', { type: 'callLastCard' }), /down to one card/);
});

test('a call made ahead lapses if the hand grows again', () => {
  const { g, act } = table(2);
  setHand(g, 'p0', ['b1', 'b2']);
  putOnTop(g, 'r3');
  act('p0', { type: 'callLastCard' });
  act('p0', { type: 'draw' });
  assert.equal(g.player('p0').hand.length, 3);
  assert.equal(g.view('p0').you!.preCalled, false);
});

test('nobody catches themselves, and only a one-card player can be caught', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  play('p0', 'g1');
  tick(LAST_CARD_GRACE_MS);
  assertRefused(g, () => act('p0', catchP0), /catch yourself/);
  assertRefused(g, () => act('p0', { type: 'catch', target: 'p1' }), /not down to one card/);
  assertRefused(g, () => g.apply('spectator', catchP0), /Unknown player/);
});

test('your own follow-up (naming a Wild\'s colour) does not close your window', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['W', 'g2']);
  play('p0', 'W');
  assert.equal(g.phase, 'color');
  tick(LAST_CARD_GRACE_MS);
  act('p0', { type: 'chooseColor', color: 'red' });
  assert.equal(g.view().oneCard[0].catchable, true);
  act('p2', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
});

test('a skipped player drawing their penalty is not the next player acting', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['g+2', 'g2']);
  play('p0', 'g+2');
  assert.equal(g.current.id, 'p2');
  tick(LAST_CARD_GRACE_MS);
  assert.equal(g.view().oneCard[0].catchable, true);
  act('p1', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
});

test('two players: a Skip down to one card keeps the window open through the extra turn', () => {
  const { g, act, play, tick } = table(2);
  setHand(g, 'p0', ['gS', 'r2']);
  play('p0', 'gS');
  assert.equal(g.current.id, 'p0');
  tick(LAST_CARD_GRACE_MS);
  act('p1', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
  assert.equal(g.current.id, 'p0', 'still their go');
});

test('a jump-in is someone acting: it closes the window', () => {
  const { g, act, play, tick } = table(3, { rules: { jumpIn: true } });
  setHand(g, 'p0', ['g1', 'g2']);
  setHand(g, 'p2', ['g1', 'r3', 'r4']);
  play('p0', 'g1');
  tick(LAST_CARD_GRACE_MS);
  play('p2', 'g1');
  assertRefused(g, () => act('p1', catchP0), /Too late/);
});

test('a pause stretches the grace: the clock that counts it was stopped', () => {
  const { g, act, play, tick } = table(3);
  setHand(g, 'p0', ['g1', 'g2']);
  play('p0', 'g1');
  tick(500);
  g.pause('Host');
  assertRefused(g, () => act('p2', catchP0), /paused/);
  tick(10_000);
  g.resume('Host');
  assertRefused(g, () => act('p2', catchP0), /Too soon/);
  tick(500);
  act('p2', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
});

test('the next player timing out closes the window too', () => {
  const { g, act, play, tick } = table(3, { rules: { turnSeconds: 30 } });
  setHand(g, 'p0', ['g1', 'g2']);
  setHand(g, 'p1', ['r3']);
  putOnTop(g, 'r4');
  play('p0', 'g1');
  tick(30_000);
  assert.ok(g.clockTimeout());
  assert.equal(g.current.id, 'p2');
  assertRefused(g, () => act('p2', catchP0), /Too late/);
});

test('drawing back up ends the one-card state; the next time needs a new call', () => {
  const { g, act, play, tick } = table(2);
  setHand(g, 'p0', ['g1', 'g2']);
  setHand(g, 'p1', ['r3', 'r5']);
  putOnTop(g, 'r6', 'b7', 'r8');
  play('p0', 'g1', { callLastCard: true });
  act('p1', { type: 'draw' }); // Red 6: no match on green
  act('p0', { type: 'draw' }); // Blue 7: no match either
  assert.equal(g.player('p0').hand.length, 2);
  assert.deepEqual(g.view().oneCard, [], 'no longer on one card');
  act('p1', { type: 'draw' });
  play('p0', 'g2');
  assert.deepEqual(g.view().oneCard.map(o => [o.player, o.calledAt, o.catchable]), [['p0', null, true]]);
  tick(LAST_CARD_GRACE_MS);
  act('p1', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
});

test('going out without calling is fine: the round is over, nothing to catch', () => {
  const { g, play } = table(3, { rules: { match: 'single' } });
  setHand(g, 'p0', ['g1']);
  play('p0', 'g1');
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.view().oneCard, []);
});

test('a caught player who plays down to one card again opens a fresh window', () => {
  const { g, act, play, tick, now } = table(2);
  setHand(g, 'p0', ['gS', 'gS', 'g3']);
  play('p0', 'gS');
  play('p0', 'gS');
  tick(LAST_CARD_GRACE_MS);
  act('p1', catchP0);
  assert.equal(g.player('p0').hand.length, 3);
  // Two more Skips put them back on one card.
  setHand(g, 'p0', ['gR', 'gR', 'g3']);
  play('p0', 'gR');
  tick(5);
  play('p0', 'gR');
  const oc = g.view().oneCard[0];
  assert.equal(oc.since, now());
  assert.equal(oc.catchable, true);
});
