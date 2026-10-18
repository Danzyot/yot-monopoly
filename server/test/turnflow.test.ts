// Turn flow: which turn the dice belong to, how long clients stage a roll
// (and so how long bots wait), and auctions that end once nobody can top the bid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.ts';
import { sceneMs, SCENE_DICE_MS, SCENE_HOP_MS, SCENE_RESULT_MS, SCENE_SETTLE_MS, SCENE_FLY_MS, SCENE_CARD_MS } from '../src/rooms.ts';
import * as PACE from '../../shared/pacing.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import { scripted } from './helpers.ts';

test('dice belong to the turn they were rolled in', () => {
  const { g, dice, act } = scripted();
  assert.equal(g.view().dice, null);
  dice(1, 2);
  act('p0', { type: 'roll' });
  let v = g.view();
  assert.deepEqual(v.dice, [1, 2]);
  assert.equal(v.rollTurn, v.turnNumber, 'rolled this turn');
  act('p0', { type: 'buy' });
  act('p0', { type: 'endTurn' });
  v = g.view();
  assert.equal(v.current, 'p1');
  assert.deepEqual(v.dice, [1, 2], 'the last roll is still on the table');
  assert.notEqual(v.rollTurn, v.turnNumber, '...but it is not this turn\'s');
  dice(2, 3);
  act('p1', { type: 'roll' });
  v = g.view();
  assert.equal(v.rollTurn, v.turnNumber);
  assert.equal(g.snapshot().rollTurn, v.turnNumber, 'saved with the game');
});

test('rollTurn: older snapshots without it read sensibly', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' });
  const init = { theme: resolveTheme('classic', 'classic'), rules: { ...DEFAULT_RULES } };
  // Mid-turn (buying): the dice are this turn's.
  const mid = g.snapshot();
  delete mid.rollTurn;
  assert.equal(Game.restore(init, mid).view().rollTurn, g.turnNumber);
  // A new turn waiting to roll: they are not.
  act('p0', { type: 'buy' });
  act('p0', { type: 'endTurn' });
  const next = g.snapshot();
  delete next.rollTurn;
  assert.notEqual(Game.restore(init, next).view().rollTurn, g.turnNumber);
});

test('scene pacing: bots wait for the dice, the result and the walk', () => {
  // The server reads the very numbers the client animates with.
  assert.equal(SCENE_DICE_MS, PACE.DICE_MS);
  assert.equal(SCENE_RESULT_MS, PACE.RESULT_MS);
  assert.equal(SCENE_HOP_MS, PACE.HOP_MS);
  assert.equal(PACE.WALK_DELAY_MS, PACE.DICE_MS + PACE.RESULT_MS);
  // The result holds about a second, and the hop is no faster than before.
  assert.ok(PACE.RESULT_HOLD_MS >= 800 && PACE.RESULT_HOLD_MS <= 1000);
  assert.ok(PACE.HOP_MS >= 190);

  const { g, dice, act } = scripted();
  const mark = () => ({ roll: g.rollSeq, card: g.lastCard?.seq ?? 0, move: g.lastMove?.seq ?? 0, at: new Map(g.players.map(p => [p.id, p.position])) });
  let seen = mark();
  assert.equal(sceneMs(seen, g), 0, 'nothing happened');
  dice(2, 4);
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 6);
  const ms = sceneMs(seen, g);
  assert.equal(ms, SCENE_DICE_MS + SCENE_RESULT_MS + 6 * SCENE_HOP_MS + SCENE_SETTLE_MS);
  assert.ok(ms >= PACE.WALK_DELAY_MS + 6 * PACE.HOP_MS, 'no bot moves before the piece has walked');

  // A drawn card flies up after the walk.
  seen = mark();
  g.lastCard = { deck: 'chance', text: 'x', player: 'p0', seq: 99 };
  assert.equal(sceneMs(seen, g), SCENE_CARD_MS + SCENE_SETTLE_MS);

  // A teleport (jail) flies instead of hopping.
  seen = mark();
  g.player('p0').position = g.jailIndex;
  g.player('p0').inJail = true;
  assert.equal(sceneMs(seen, g), SCENE_FLY_MS + SCENE_SETTLE_MS);
});

test('auction: a bid nobody else can top ends it at once', () => {
  const { g, dice, act } = scripted(3);
  g.player('p2').cash = 40;
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  assert.equal(g.phase, 'auction');
  act('p1', { type: 'bid', amount: 40 });
  // p2 has 40 to spend: 41 is out of reach, so p2 is out; p0 still has a say.
  assert.deepEqual(g.auction!.bidders, ['p0', 'p1']);
  assert.match(g.log.at(-1)!.text, /P2 can't top \$40 and drops out/);
  act('p0', { type: 'bid', amount: 60 });
  assert.equal(g.phase, 'auction');
  // Only p1 is left to answer; once p1 drops, p0 has it.
  act('p1', { type: 'pass' });
  assert.equal(g.auction, null);
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.player('p0').cash, 1500 - 60);
});

test('auction: outbidding everyone left brings the hammer down', () => {
  const { g, dice, act } = scripted(2);
  g.player('p1').cash = 100;
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  act('p0', { type: 'bid', amount: 100 });
  assert.equal(g.auction, null, 'p1 cannot beat 100 with 100: sold, no waiting for the clock');
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.phase, 'done');
});

test('auction: what you owe counts against what you can bid', () => {
  const { g, dice, act } = scripted(3);
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  g.debts.push({ from: 'p2', to: 'p0', amount: 1450, reason: 'test' });
  act('p1', { type: 'bid', amount: 50 });
  assert.ok(!g.auction!.bidders.includes('p2'), 'p2 can spend 50: not enough to top 50');
  assert.ok(g.auction!.bidders.includes('p0'));
});

test('rollBy names who threw the dice, even once the turn has moved on', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.view().rollBy, 'p0');
  act('p0', { type: 'buy' });
  act('p0', { type: 'endTurn' });
  const v = g.view();
  assert.equal(v.current, 'p1');
  assert.equal(v.rollBy, 'p0', 'the dice on the table are still p0\'s');
  const init = { theme: resolveTheme('classic', 'classic'), rules: { ...DEFAULT_RULES } };
  assert.equal(Game.restore(init, g.snapshot()).view().rollBy, 'p0', 'saved with the game');
});
