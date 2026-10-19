// House rules, each off by default: stacking (plain and mixed), 7-0, jump-in,
// draw until playable, forced play, and no bluffing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertConserved, assertRefused, putOnTop, setHand, setTop, specs, table } from './cardsHelpers.ts';

// ---- stacking -------------------------------------------------------------------

test('stacking off (official): a Draw Two cannot be answered — it simply lands', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g+2', 'g1']);
  setHand(g, 'p1', ['r+2', 'g3']);
  play('p0', 'g+2');
  assert.equal(g.player('p1').hand.length, 4);
  assert.equal(g.current.id, 'p2');
});

test('stacking: Draw Two on Draw Two passes the growing penalty on', () => {
  const { g, act, play } = table(3, { rules: { stacking: true } });
  setHand(g, 'p0', ['g+2', 'g1']);
  setHand(g, 'p1', ['r+2', 'W4', 'g3']);
  setHand(g, 'p2', ['b5', 'g6']);
  play('p0', 'g+2');
  assert.equal(g.current.id, 'p1', 'the target decides');
  assert.equal(g.player('p1').hand.length, 3, 'nothing drawn yet');
  const v = g.view('p1');
  assert.deepEqual(v.pendingDraw, { amount: 2, kind: 'draw2', from: 'p0', challengeable: false });
  assert.deepEqual(v.you!.playable.length, 1, 'only the Draw Two stacks (a Draw Four needs mixed stacking)');
  assertRefused(g, () => play('p1', 'g3'), /Stack a Draw card or draw 2/);
  assertRefused(g, () => play('p1', 'W4', { color: 'red' }), /Stack a Draw card/);
  play('p1', 'r+2'); // any colour: it matches by symbol
  assert.equal(g.current.id, 'p2');
  assert.equal(g.pending!.amount, 4);
  assertRefused(g, () => play('p2', 'g6'), /draw 4/);
  act('p2', { type: 'draw' });
  assert.equal(g.player('p2').hand.length, 6);
  assert.equal(g.current.id, 'p0', 'and misses the turn');
  assert.equal(g.pending, null);
  assertConserved(g);
});

test('stacking: Draw Four on Draw Four; a stacked one cannot be challenged', () => {
  const { g, act, play } = table(3, { rules: { stacking: true } });
  setHand(g, 'p0', ['W4', 'g1']); // a bluff (holds green), but stacked on it can no longer be challenged
  setHand(g, 'p1', ['W4', 'r2']);
  play('p0', 'W4', { color: 'blue' });
  assert.equal(g.view('p1').pendingDraw!.challengeable, true);
  play('p1', 'W4', { color: 'red' });
  assert.deepEqual(g.view('p2').pendingDraw, { amount: 8, kind: 'wild4', from: 'p1', challengeable: false });
  assertRefused(g, () => act('p2', { type: 'challenge' }), /nothing to challenge/);
  act('p2', { type: 'draw' });
  assert.equal(g.player('p2').hand.length, 15);
  assert.equal(g.color, 'red');
});

test('stacking: a Draw Four played on a stack may name its colour later', () => {
  const { g, act, play } = table(3, { rules: { stacking: true } });
  setHand(g, 'p0', ['W4', 'r1']);
  setHand(g, 'p1', ['W4', 'r2']);
  play('p0', 'W4', { color: 'blue' });
  play('p1', 'W4');
  assert.equal(g.phase, 'color');
  act('p1', { type: 'chooseColor', color: 'yellow' });
  assert.equal(g.current.id, 'p2');
  assert.equal(g.pending!.amount, 8);
});

test('mixed stacking: Draw Four on Draw Two, and a Draw Two in the named colour on Draw Four', () => {
  const { g, act, play } = table(4, { rules: { stacking: true, stackMixed: true } });
  setHand(g, 'p0', ['g+2', 'g1']);
  setHand(g, 'p1', ['W4', 'r2']);
  setHand(g, 'p2', ['b+2', 'r+2', 'r3']);
  play('p0', 'g+2');
  play('p1', 'W4', { color: 'red' });
  assert.deepEqual(g.view('p2').pendingDraw, { amount: 6, kind: 'wild4', from: 'p1', challengeable: false });
  assertRefused(g, () => play('p2', 'b+2'), /Stack a Draw card/);
  play('p2', 'r+2');
  assert.equal(g.pending!.amount, 8);
  act('p3', { type: 'draw' });
  assert.equal(g.player('p3').hand.length, 15);
  assert.equal(g.current.id, 'p0');
});

test('stacking: going out on a stack makes the next player take the lot', () => {
  const { g, play } = table(3, { rules: { stacking: true, match: 'single' } });
  setHand(g, 'p0', ['g+2', 'g1']);
  setHand(g, 'p1', ['r+2']);
  play('p0', 'g+2');
  play('p1', 'r+2');
  assert.equal(g.phase, 'over');
  assert.equal(g.player('p2').hand.length, 11);
  assert.equal(g.winner, 'p1');
});

// ---- 7-0 ------------------------------------------------------------------------

test('7-0: a 7 swaps hands with the chosen player', () => {
  const { g, play } = table(3, { rules: { sevenZero: true } });
  setHand(g, 'p0', ['g7', 'r1', 'r2']);
  setHand(g, 'p2', ['b1']);
  play('p0', 'g7', { target: 'p2' });
  assert.deepEqual(specs(g, 'p0'), ['b1']);
  assert.deepEqual(specs(g, 'p2'), ['r1', 'r2']);
  assert.equal(g.current.id, 'p1');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'swap']);
  assert.match(g.log.at(-1)!.text, /P0 swaps hands with P2/);
  assertConserved(g);
});

test('7-0: a 7 without a partner asks for one; two players swap at once', () => {
  const { g, act, play } = table(3, { rules: { sevenZero: true } });
  setHand(g, 'p0', ['g7', 'r1']);
  play('p0', 'g7');
  assert.equal(g.phase, 'swap');
  assertRefused(g, () => act('p0', { type: 'swap', target: 'p0' }), /yourself/);
  assertRefused(g, () => act('p1', { type: 'swap', target: 'p0' }), /Not your turn/);
  assertRefused(g, () => act('p0', { type: 'swap', target: 'nobody' }), /Unknown player/);
  act('p0', { type: 'swap', target: 'p1' });
  assert.equal(g.player('p1').hand.length, 1);
  assert.equal(g.current.id, 'p1');

  const two = table(2, { rules: { sevenZero: true } });
  setHand(two.g, 'p0', ['g7', 'r1']);
  two.play('p0', 'g7');
  assert.deepEqual(specs(two.g, 'p1'), ['r1']);
  assert.equal(two.g.current.id, 'p1');
});

test('7-0: a 0 passes every hand on in the direction of play', () => {
  const { g, play } = table(3, { rules: { sevenZero: true } });
  setHand(g, 'p0', ['g0', 'r1']);
  setHand(g, 'p1', ['b1', 'b2']);
  setHand(g, 'p2', ['y1', 'y2', 'y3']);
  play('p0', 'g0');
  assert.deepEqual(specs(g, 'p1'), ['r1'], 'p0 → p1');
  assert.deepEqual(specs(g, 'p2'), ['b1', 'b2'], 'p1 → p2');
  assert.deepEqual(specs(g, 'p0'), ['y1', 'y2', 'y3'], 'p2 → p0');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'rotate']);

  // The other way round after a Reverse.
  const r = table(3, { rules: { sevenZero: true } });
  setHand(r.g, 'p0', ['g0', 'r1']);
  setHand(r.g, 'p1', ['b1', 'b2']);
  setHand(r.g, 'p2', ['y1', 'y2', 'y3']);
  r.g.direction = -1;
  r.play('p0', 'g0');
  assert.deepEqual(specs(r.g, 'p2'), ['r1'], 'p0 → p2');
  assert.deepEqual(specs(r.g, 'p0'), ['b1', 'b2'], 'p1 → p0');
  assert.deepEqual(specs(r.g, 'p1'), ['y1', 'y2', 'y3'], 'p2 → p1');
  assert.equal(r.g.current.id, 'p2');
});

test('7-0 off (official): 7 and 0 are plain numbers', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g7', 'r1']);
  play('p0', 'g7', { target: 'p2' });
  assert.deepEqual(specs(g, 'p0'), ['r1']);
  assert.equal(g.current.id, 'p1');
});

// ---- jump-in ----------------------------------------------------------------------

test('jump-in: an identical card out of turn; play carries on from the jumper', () => {
  const { g, play } = table(4, { rules: { jumpIn: true } });
  setHand(g, 'p0', ['g5', 'r1']);
  setHand(g, 'p2', ['g5', 'g9', 'r9', 'W']);
  play('p0', 'g5');
  assert.equal(g.current.id, 'p1');
  assert.deepEqual(g.view('p2').you!.playable, [g.player('p2').hand[0].id], 'only the identical card');
  assertRefused(g, () => play('p2', 'g9'), /only an identical card/);
  assertRefused(g, () => play('p2', 'W', { color: 'red' }), /only an identical card/);
  play('p2', 'g5');
  assert.equal(g.current.id, 'p3', 'p1 lost their turn to the jump-in');
  const step = g.lastPlay!.steps[0];
  assert.ok(step.type === 'play' && step.jumpIn);
  assert.match(g.log.at(-1)!.text, /P2 jumps in with Green 5!/);
});

test('jump-in: action cards take effect from the jumper', () => {
  // A Skip jumped in skips the player after the jumper.
  const { g, play } = table(4, { rules: { jumpIn: true } });
  setHand(g, 'p0', ['gS', 'r1']);
  setHand(g, 'p3', ['gS', 'r2']);
  play('p0', 'gS');
  assert.equal(g.current.id, 'p2');
  play('p3', 'gS');
  assert.equal(g.current.id, 'p1', 'p3 jumped in and skipped p0');
  // A Reverse jumped in turns play round again, from the jumper.
  const r = table(4, { rules: { jumpIn: true } });
  setHand(r.g, 'p0', ['gR', 'r1']);
  setHand(r.g, 'p2', ['gR', 'r2']);
  r.play('p0', 'gR');
  assert.equal(r.g.current.id, 'p3');
  r.play('p2', 'gR');
  assert.equal(r.g.direction, 1, 'reversed back');
  assert.equal(r.g.current.id, 'p3', 'from the jumper, play goes on to p3');
});

test('jump-in: not while a penalty or a choice is pending, and off by default', () => {
  const { g, play } = table(3, { rules: { jumpIn: true, stacking: true } });
  setHand(g, 'p0', ['g+2', 'r1']);
  setHand(g, 'p2', ['g+2', 'r2']);
  play('p0', 'g+2');
  assertRefused(g, () => play('p2', 'g+2'), /Not your turn/);

  const off = table(3);
  setHand(off.g, 'p0', ['g5', 'r1']);
  setHand(off.g, 'p2', ['g5', 'r2']);
  off.play('p0', 'g5');
  assertRefused(off.g, () => off.play('p2', 'g5'), /Not your turn/);
});

// ---- drawing house rules ------------------------------------------------------------

test('draw until playable: keep drawing until a card fits', () => {
  const { g, act } = table(3, { rules: { drawUntilPlayable: true } });
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'r2', 'b3', 'g4', 'r5');
  act('p0', { type: 'draw' });
  assert.deepEqual(specs(g, 'p0'), ['r1', 'r2', 'b3', 'g4']);
  assert.equal(g.phase, 'drawn');
  assert.match(g.log.at(-1)!.text, /P0 draws 3 cards\./);
  // Official rules: just the one.
  const off = table(3);
  setHand(off.g, 'p0', ['r1']);
  putOnTop(off.g, 'r2', 'b3', 'g4');
  off.act('p0', { type: 'draw' });
  assert.deepEqual(specs(off.g, 'p0'), ['r1', 'r2']);
  assert.equal(off.g.current.id, 'p1');
});

test('forced play: a playable card drawn must be played', () => {
  const { g, act, play } = table(3, { rules: { forcedPlay: true } });
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'g4');
  act('p0', { type: 'draw' });
  assert.equal(g.view('p0').you!.canPass, false);
  assertRefused(g, () => act('p0', { type: 'pass' }), /must play the card you drew/);
  play('p0', 'g4');
  assert.equal(g.current.id, 'p1');
});

// ---- no bluffing --------------------------------------------------------------------

test('no bluffing: Draw Four is always legal, never challengeable, and lands at once', () => {
  const { g, act, play } = table(3, { rules: { noBluff: true } });
  setHand(g, 'p0', ['W4', 'g1']); // would be a bluff under the official rule
  play('p0', 'W4', { color: 'red' });
  assert.equal(g.player('p1').hand.length, 11);
  assert.equal(g.current.id, 'p2');
  assertRefused(g, () => act('p2', { type: 'challenge' }), /nothing to challenge/);

  // With stacking the target still decides, but cannot challenge.
  const s = table(3, { rules: { noBluff: true, stacking: true } });
  setHand(s.g, 'p0', ['W4', 'g1']);
  s.play('p0', 'W4', { color: 'red' });
  assert.equal(s.g.view('p1').pendingDraw!.challengeable, false);
  assert.equal(s.g.view('p1').you!.canChallenge, false);
  assertRefused(s.g, () => s.act('p1', { type: 'challenge' }), /nothing to challenge/);
});

test('7-0: swapping away the last-but-one card hands over no call duty', () => {
  const { g, play } = table(3, { rules: { sevenZero: true, jumpIn: true } });
  setTop(g, 'b7');
  setHand(g, 'p0', ['b7', 'r1']);
  setHand(g, 'p1', ['b2', 'y2', 'y3']);
  play('p0', 'b7', { target: 'p1' });
  // p0 went down to one card, then swapped it away: they hold p1's three now.
  assert.equal(g.player('p0').hand.length, 3);
  assert.deepEqual(g.view().oneCard, [], 'receiving a one-card hand is not going down to one');
  assertConserved(g);
});
