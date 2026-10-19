// Turn timers and timeouts (draw, then pass), away/autopilot, pause, the
// round break, players leaving, and snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFK_AFTER, CardsGame, PAUSE_MAX_MS, ROUND_BREAK_MS } from '../src/cards/game.ts';
import { assertConserved, assertRefused, putOnTop, setHand, specs, table } from './cardsHelpers.ts';

const TURN = 30_000;

test('turn timer: a timeout draws for the player, then passes', () => {
  const { g, tick, now } = table(3, { rules: { turnSeconds: 30 } });
  assert.equal(g.turnEndsAt, now() + TURN);
  assert.equal(g.clockDeadline(), g.turnEndsAt);
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'b2');
  tick(TURN - 1);
  assert.equal(g.clockTimeout(), false, 'not yet');
  tick(1);
  assert.equal(g.clockTimeout(), true);
  assert.deepEqual(specs(g, 'p0'), ['r1', 'b2']);
  assert.equal(g.current.id, 'p1');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['timeout', 'draw']);
  assert.ok(g.log.some(l => l.text === '⏱ P0 ran out of time.'));
  assert.equal(g.turnEndsAt, now() + TURN, 'the next player gets a full window');
});

test('timeout: even a playable draw is passed on (the player keeps it)', () => {
  const { g, tick } = table(3, { rules: { turnSeconds: 30 } });
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'g2');
  tick(TURN);
  g.clockTimeout();
  assert.deepEqual(specs(g, 'p0'), ['r1', 'g2']);
  assert.equal(g.current.id, 'p1');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['timeout', 'draw', 'pass']);
});

test('timeout after drawing: the drawn card is kept and the turn passes', () => {
  const { g, act, tick, now } = table(3, { rules: { turnSeconds: 30 } });
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'g2');
  tick(10_000);
  act('p0', { type: 'draw' });
  assert.equal(g.phase, 'drawn');
  assert.equal(g.turnEndsAt, now() + TURN, 'a new step, a new window');
  tick(TURN);
  g.clockTimeout();
  assert.equal(g.current.id, 'p1');
  assert.equal(g.player('p0').hand.length, 2);
});

test('timeout with forced play: the drawn card is played, a Wild in the colour held most', () => {
  const { g, tick } = table(3, { rules: { turnSeconds: 30, forcedPlay: true } });
  setHand(g, 'p0', ['b1', 'b2', 'r3']);
  putOnTop(g, 'W');
  tick(TURN);
  g.clockTimeout();
  assert.equal(g.top!.kind, 'wild');
  assert.equal(g.color, 'blue');
  assert.equal(g.current.id, 'p1');
});

test('timeout facing a penalty takes it (and never challenges)', () => {
  const { g, play, tick } = table(3, { rules: { turnSeconds: 30, stacking: true } });
  setHand(g, 'p0', ['g+2', 'g1']);
  play('p0', 'g+2');
  tick(TURN);
  g.clockTimeout();
  assert.equal(g.player('p1').hand.length, 9);
  assert.equal(g.current.id, 'p2');

  const w = table(3, { rules: { turnSeconds: 30 } });
  setHand(w.g, 'p0', ['W4', 'g1']); // a bluff a challenge would catch
  w.play('p0', 'W4', { color: 'red' });
  w.tick(TURN);
  w.g.clockTimeout();
  assert.equal(w.g.player('p1').hand.length, 11);
  assert.equal(w.g.player('p0').hand.length, 1);
});

test('timeout while naming a colour picks the colour held most; while swapping, the smallest hand', () => {
  const { g, play, tick } = table(3, { rules: { turnSeconds: 30 } });
  setHand(g, 'p0', ['W', 'b1', 'b2', 'r3']);
  play('p0', 'W');
  tick(TURN);
  g.clockTimeout();
  assert.equal(g.color, 'blue');
  assert.equal(g.current.id, 'p1');

  const s = table(3, { rules: { turnSeconds: 30, sevenZero: true } });
  setHand(s.g, 'p0', ['g7', 'r1', 'r2']);
  setHand(s.g, 'p2', ['b1', 'b2']);
  s.play('p0', 'g7');
  assert.equal(s.g.phase, 'swap');
  assert.equal(s.g.defaultSwapTarget('p0'), 'p2');
  s.tick(TURN);
  s.g.clockTimeout();
  assert.deepEqual(specs(s.g, 'p0'), ['b1', 'b2']);
});

test('away: two timeouts in a row turn on autopilot; only the player\'s own move turns it off', () => {
  const { g, act, tick } = table(2, { rules: { turnSeconds: 30 } });
  putOnTop(g, 'r1', 'r2', 'r3', 'r4', 'b1', 'b2', 'b3');
  for (let i = 0; i < 3; i++) {
    tick(TURN);
    g.clockTimeout();
  }
  assert.equal(AFK_AFTER, 2);
  assert.equal(g.player('p0').afk, true);
  assert.ok(!g.player('p1').afk, 'one timeout is not away');
  assert.ok(g.log.some(l => /P0 seems to be away/.test(l.text)));
  assert.equal(g.view().players[0].afk, true);
  act('p1', { type: 'draw' });
  g.apply('p0', { type: 'draw' }, { auto: true });
  assert.equal(g.player('p0').afk, true, 'an autopilot move is not the player coming back');
  act('p1', { type: 'draw' });
  act('p0', { type: 'draw' });
  assert.equal(g.player('p0').afk, false);
  assert.equal(g.log.at(-1)!.text, 'P0 is back.');
});

test('no clock for bots, and none when the timer is off', () => {
  const { g } = table(3, { bots: { 0: true } });
  assert.equal(g.current.isBot, true);
  assert.equal(g.turnEndsAt, null);
  assert.equal(g.clockDeadline(), null);
  const off = table(3, { rules: { turnSeconds: 0 } });
  assert.equal(off.g.turnEndsAt, null);
  assert.equal(off.g.clockTimeout(), false);
});

test('holdTurnClock: the clock starts once the play has animated', () => {
  const { g, now } = table(3, { rules: { turnSeconds: 30 } });
  const start = now();
  g.holdTurnClock(start + 4_000);
  assert.equal(g.turnEndsAt, start + 4_000 + TURN);
  g.holdTurnClock(start + 1_000);
  assert.equal(g.turnEndsAt, start + 4_000 + TURN, 'never earlier');
});

test('pause: nothing moves, the clocks stop, and resume where they were', () => {
  const { g, act, tick, now } = table(3, { rules: { turnSeconds: 30 } });
  tick(10_000);
  g.pause('Host');
  assertRefused(g, () => g.pause('Host'), /Already paused/);
  assertRefused(g, () => act('p0', { type: 'draw' }), /paused by Host/);
  assert.equal(g.clockDeadline(), now() + PAUSE_MAX_MS);
  assert.deepEqual(g.view('p0').you!.playable, []);
  tick(60_000);
  g.resume('Host');
  assert.equal(g.turnEndsAt, now() + 20_000, '20 s were left');
  assertRefused(g, () => g.resume('Host'), /not paused/);
  // A pause ends by itself after the limit.
  g.pause('Host');
  tick(PAUSE_MAX_MS);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.paused, null);
  assert.match(g.log.at(-1)!.text, /resumed \(pause time limit\)/);
});

test('round break: held for the animation, then the next deal', () => {
  const { g, play, tick, now } = table(3);
  setHand(g, 'p0', ['g1']);
  play('p0', 'g1');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.nextRoundAt, now() + ROUND_BREAK_MS);
  g.holdTurnClock(now() + 3_000);
  assert.equal(g.nextRoundAt, now() + 3_000 + ROUND_BREAK_MS);
  tick(ROUND_BREAK_MS);
  assert.equal(g.clockTimeout(), false);
  tick(3_000);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.round, 2);
});

test('leaving: cards go under the pile, play moves on, the last one at the table wins', () => {
  const { g, act } = table(4);
  g.forfeit('p0');
  assert.equal(g.player('p0').left, true);
  assert.equal(g.player('p0').hand.length, 0);
  assert.equal(g.current.id, 'p1', 'it was their turn: it moves on');
  assert.equal(g.pile.length, 108 - 21 - 1);
  assert.deepEqual(g.lastPlay!.steps, [{ type: 'leave', player: 'p0' }]);
  assertRefused(g, () => act('p0', { type: 'draw' }), /left the table/);
  assertRefused(g, () => g.forfeit('p0'), /left the table/);
  assertConserved(g);
  g.forfeit('p3');
  assert.equal(g.current.id, 'p1');
  g.forfeit('p1');
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p2');
  assert.match(g.log.at(-1)!.text, /P2 wins — everyone else has left/);
  assertConserved(g);
});

test('leaving: a player leaving mid-penalty or mid-choice does not stall the table', () => {
  const { g, play } = table(3, { rules: { stacking: true } });
  setHand(g, 'p0', ['g+2', 'g1']);
  play('p0', 'g+2');
  g.forfeit('p1'); // the target of the penalty
  assert.equal(g.current.id, 'p2');
  assert.equal(g.pending, null);

  const c = table(3, { flip: ['W'] });
  c.g.forfeit('p0'); // was naming the start colour
  assert.ok(c.g.color);
  assert.equal(c.g.phase, 'play');
  assert.equal(c.g.current.id, 'p1');

  const w = table(3);
  setHand(w.g, 'p0', ['W4', 'g1']);
  w.play('p0', 'W4', { color: 'red' });
  w.g.forfeit('p0'); // a Draw Four from someone who left cannot be challenged
  assert.equal(w.g.view('p1').pendingDraw!.challengeable, false);
});

test('a player leaving shifts the deal to the next seat still there', () => {
  const { g, play, tick } = table(3, { rules: { targetScore: 500 } });
  setHand(g, 'p0', ['g1']);
  play('p0', 'g1');
  g.forfeit('p0'); // the next dealer
  tick(ROUND_BREAK_MS);
  g.clockTimeout();
  assert.equal(g.players[g.dealerIdx].id, 'p1');
  assert.equal(g.player('p0').hand.length, 0, 'not dealt in');
  assert.equal(g.current.id === 'p2' || g.current.id === 'p1', true);
  assertConserved(g);
});

test('snapshot and restore: the game carries on exactly, deadlines moved on by the downtime', () => {
  const { g, play, tick, now } = table(3, { rules: { turnSeconds: 30, stacking: true } });
  setHand(g, 'p0', ['W4', 'r1']);
  play('p0', 'W4');
  const snap = g.snapshot();
  const restored = CardsGame.restore({ now: () => now() + 5_000, rng: () => 0 }, snap);
  assert.equal(restored.phase, 'color');
  assert.equal(restored.turnEndsAt, g.turnEndsAt! + 5_000);
  // Same move on both: same outcome.
  tick(0);
  const live = CardsGame.restore({ now, rng: () => 0 }, snap);
  live.apply('p0', { type: 'chooseColor', color: 'blue' });
  g.apply('p0', { type: 'chooseColor', color: 'blue' });
  const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'savedAt' ? undefined : v));
  assert.equal(strip(live.snapshot()), strip(g.snapshot()));
  assert.equal(strip(live.view('p1')), strip(g.view('p1')));
  assertConserved(restored);
});
