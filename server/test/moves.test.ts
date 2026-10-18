// Moves recorded leg by leg (Game.lastMove), so clients can stage them (walk to
// the Chance square, read the card, walk on) and bots wait for exactly that;
// money lines carrying player ids; and names nobody at the table shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.ts';
import { Room, sceneMs, type RoomHooks } from '../src/rooms.ts';
import * as PACE from '../../shared/pacing.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import { scripted } from './helpers.ts';

const CLASSIC = resolveTheme('classic', 'classic');
const chance = (f: (e: (typeof CLASSIC.chance)[number]['effect']) => boolean) => {
  const i = CLASSIC.chance.findIndex(c => f(c.effect));
  assert.ok(i >= 0);
  return i;
};
const ROLL = PACE.DICE_MS + PACE.RESULT_MS;
const mark = (g: Game) => ({ roll: g.rollSeq, card: g.lastCard?.seq ?? 0, move: g.lastMove?.seq ?? 0, at: new Map(g.players.map(p => [p.id, p.position])) });

test('lastMove: a card that advances walks there, then the card, then on to GO', () => {
  const { g, dice, act } = scripted();
  g.decks.chance = [chance(e => e.type === 'advance' && e.to === 0)];
  const seen = mark(g);
  dice(3, 4); // 0 → 7 Chance → Advance to GO
  act('p0', { type: 'roll' });
  const m = g.view().lastMove!;
  assert.equal(m.player, 'p0');
  assert.equal(m.roll, g.rollSeq, 'came with this throw');
  assert.equal(m.legs.length, 2);
  assert.deepEqual({ ...m.legs[0], card: undefined }, { to: 7, kind: 'roll', steps: 7, card: undefined });
  assert.equal(m.legs[0].card?.seq, g.lastCard!.seq, 'the card shows on arriving at the Chance square');
  assert.deepEqual(m.legs[1], { to: 0, kind: 'card', steps: 33 });
  assert.equal(g.player('p0').position, 0);
  // The salary is its own money line, tied to this move.
  const salary = g.log.find(l => l.reason === 'salary')!;
  assert.deepEqual([salary.to, salary.amount, salary.move], ['p0', 200, m.seq]);
  assert.ok(g.log.filter(l => l.text.includes('drew')).every(l => l.move === m.seq));
  // Bots wait for the dice, the walk, the card and the trip to GO (a long jump flies).
  assert.equal(sceneMs(seen, g), ROLL + 7 * PACE.HOP_MS + PACE.CARD_MS + PACE.FLY_MS + PACE.SETTLE_MS);
  assert.equal(PACE.moveMs(m.legs), 7 * PACE.HOP_MS + PACE.CARD_MS + PACE.FLY_MS);
});

test('lastMove: a go-to-jail card flies to jail after the card', () => {
  const { g, dice, act } = scripted();
  g.decks.chance = [chance(e => e.type === 'jail')];
  dice(3, 4);
  act('p0', { type: 'roll' });
  const m = g.lastMove!;
  assert.deepEqual(m.legs.map(l => [l.to, l.kind, l.steps, !!l.card]), [[7, 'roll', 7, true], [g.jailIndex, 'jail', undefined, false]]);
  assert.ok(g.player('p0').inJail);
});

test('lastMove: the Go To Jail square walks there, then flies to jail', () => {
  const { g, dice, act } = scripted();
  g.player('p0').position = 25;
  const seen = mark(g);
  dice(2, 3);
  act('p0', { type: 'roll' });
  const m = g.lastMove!;
  assert.deepEqual(m.legs, [{ to: 30, kind: 'roll', steps: 5 }, { to: g.jailIndex, kind: 'jail' }]);
  assert.equal(sceneMs(seen, g), ROLL + 5 * PACE.HOP_MS + PACE.FLY_MS + PACE.SETTLE_MS);
});

test('lastMove: "go back 3" walks backwards onto Community Chest and draws again', () => {
  const { g, dice, act } = scripted();
  g.decks.chance = [chance(e => e.type === 'back')];
  g.decks.chest = [CLASSIC.chest.findIndex(c => c.effect.type === 'collect')];
  g.player('p0').position = 31;
  const seen = mark(g);
  dice(2, 3); // 31 → 36 Chance → back 3 → 33 Community Chest
  act('p0', { type: 'roll' });
  const m = g.lastMove!;
  assert.deepEqual(m.legs.map(l => [l.to, l.kind, l.steps, l.card?.deck]), [[36, 'roll', 5, 'chance'], [33, 'card', -3, 'chest']]);
  assert.equal(g.lastCard!.deck, 'chest');
  // Two cards, read one after the other, with the walk back between them.
  assert.equal(sceneMs(seen, g), ROLL + 5 * PACE.HOP_MS + PACE.CARD_MS + 3 * PACE.HOP_MS + PACE.CARD_MS + PACE.SETTLE_MS);
  // The card's prize is a money line too.
  const prize = [...g.log].reverse().find(l => l.reason === 'card')!;
  assert.equal(prize.to, 'p0');
  assert.ok(prize.amount! > 0);
});

test('lastMove: three doubles fly straight to jail; a failed jail roll moves nothing', () => {
  const { g, dice, act } = scripted();
  g.doublesCount = 2; // two doubles already this turn
  dice(3, 3); act('p0', { type: 'roll' });
  assert.ok(g.player('p0').inJail);
  assert.deepEqual(g.lastMove!.legs, [{ to: g.jailIndex, kind: 'jail' }]);
  act('p0', { type: 'endTurn' });
  g.player('p1').inJail = true; // p1 waits behind bars too
  g.player('p1').position = g.jailIndex;
  const seen = mark(g);
  dice(1, 2); act('p1', { type: 'roll' });
  assert.deepEqual(g.lastMove!.legs, [], 'no doubles: still in jail');
  assert.equal(g.lastMove!.roll, g.rollSeq);
  assert.equal(sceneMs(seen, g), ROLL + PACE.SETTLE_MS, 'just the dice');
});

test('lastMove: out of jail on doubles the first hop is a leap', () => {
  const { g, dice, act } = scripted();
  g.player('p0').position = g.jailIndex;
  g.player('p0').inJail = true;
  dice(2, 2); act('p0', { type: 'roll' });
  assert.deepEqual(g.lastMove!.legs[0], { to: 14, kind: 'roll', steps: 4, leap: true });
  assert.equal(PACE.legWalkMs(g.lastMove!.legs[0]), 5 * PACE.HOP_MS);
});

test('lastMove: saved with the game; older snapshots read as none', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' });
  const init = { theme: CLASSIC, rules: { ...DEFAULT_RULES } };
  const snap = g.snapshot();
  assert.deepEqual(Game.restore(init, snap).view().lastMove, g.view().lastMove);
  delete snap.lastMove;
  delete snap.moveSeq;
  const old = Game.restore(init, snap);
  assert.equal(old.view().lastMove, null);
  // ...and the next move still gets a fresh record.
  old.apply('p0', { type: 'decline' });
});

test('money lines carry who paid whom, so names are never matched', () => {
  const { g, dice, act } = scripted();
  g.owned[3] = { owner: 'p1', houses: 0, mortgaged: false };
  dice(1, 2);
  act('p0', { type: 'roll' });
  const rent = g.log.find(l => l.reason?.startsWith('rent'))!;
  assert.deepEqual([rent.from, rent.to, rent.amount, rent.move], ['p0', 'p1', g.rentFor(3), g.lastMove!.seq]);
  assert.equal(rent.owed, undefined);
});

test('sceneMs: a later move counts its own legs; the room never shortens a scene still playing', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'buy' });
  const seen = mark(g);
  // Nothing new moved: no scene.
  assert.equal(sceneMs(seen, g), 0);
  act('p0', { type: 'endTurn' });
  dice(3, 3);
  act('p1', { type: 'roll' });
  assert.equal(sceneMs(seen, g), ROLL + 6 * PACE.HOP_MS + PACE.SETTLE_MS);
});

// ---- unique names -------------------------------------------------------------

const hooks = (): RoomHooks => ({ onChange() {}, onEvent() {}, onFinished() {} });
const member = (id: string, name: string) => ({ id, name, avatar: '🙂' });

test('names: a second "Alex" at the table becomes "Alex 2", bots included', () => {
  const r = new Room('ABCD', 'a', hooks());
  r.join(member('a', 'Alex'));
  r.join(member('b', 'Alex'));
  r.join(member('c', 'alex'));
  assert.deepEqual(r.seats.map(s => s.name), ['Alex', 'Alex 2', 'alex 3']);
  // Rejoining keeps (or re-earns) a free name.
  r.join(member('b', 'Alex'));
  assert.equal(r.seat('b')!.name, 'Alex 2');
  // A player who took a bot's name: the bot picks another.
  r.join(member('d', 'Rich Uncle'));
  r.addBot('a', false);
  const names = r.seats.map(s => s.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'all different');
  r.start('a', false);
  const players = r.view().game!.players.map(p => p.name);
  assert.equal(new Set(players).size, players.length);
  r.dispose();
});
