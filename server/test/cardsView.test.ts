// What each viewer is shown. view() never leaks hidden information: other
// hands are counts, the draw pile is a count, a draw is shown only to the
// drawer, a challenged hand only to the challenger, a Wild Draw Four's
// legality to nobody, and spectators see no hand at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardsGame } from '../src/cards/game.ts';
import type { CardsView } from '../../shared/cards/types.ts';
import { matcher, putOnTop, setHand, table } from './cardsHelpers.ts';

/** Ids of every card object anywhere in a view. */
function cardIds(v: unknown): number[] {
  const out: number[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.id === 'number' && typeof o.kind === 'string') out.push(o.id);
    for (const val of Object.values(o)) walk(val);
  };
  walk(v);
  return out;
}

/** Cards in other players' hands or the pile that this view shows: must be none. */
function leaked(g: CardsGame, v: CardsView, viewer?: string): number[] {
  const hidden = new Set([...g.pile, ...g.players.filter(p => p.id !== viewer).flatMap(p => p.hand)].map(c => c.id));
  return cardIds(v).filter(id => hidden.has(id));
}

test('a player sees their own hand; everyone else\'s is just a count', () => {
  const { g } = table(4);
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    const v = g.view(id);
    assert.deepEqual(v.you!.hand.map(c => c.id), g.player(id).hand.map(c => c.id));
    assert.deepEqual(leaked(g, v, id), [], id);
    for (const p of v.players) {
      assert.equal(p.cards, 7);
      assert.ok(!('hand' in p));
    }
    assert.equal(v.drawCount, g.pile.length);
    assert.ok(!('pile' in v));
  }
});

test('spectators see the table, never a hand', () => {
  const { g } = table(3);
  for (const v of [g.view(), g.view('someone-watching')]) {
    assert.equal(v.you, null);
    assert.deepEqual(leaked(g, v), []);
    assert.deepEqual(cardIds(v).filter(id => id !== g.top!.id), [], 'only the face-up card');
  }
});

test('a draw: the drawer sees the card, the others see how many', () => {
  const { g, act } = table(3);
  setHand(g, 'p0', ['r1']);
  putOnTop(g, 'r4');
  act('p0', { type: 'draw' });
  const mine = g.view('p0').lastPlay!.steps.find(s => s.type === 'draw')!;
  const theirs = g.view('p1').lastPlay!.steps.find(s => s.type === 'draw')!;
  const watcher = g.view().lastPlay!.steps.find(s => s.type === 'draw')!;
  assert.ok(mine.type === 'draw' && mine.cards!.length === 1 && matcher('r4')(mine.cards![0]));
  assert.deepEqual(theirs, { type: 'draw', player: 'p0', count: 1, reason: 'turn' });
  assert.deepEqual(watcher, theirs);
  assert.deepEqual(leaked(g, g.view('p1'), 'p1'), []);
  // ...and the log never names it.
  assert.ok(!g.log.some(l => l.text.includes('Red 4')));
});

test('a penalty draw and a catch draw are private to the drawer as well', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g+2', 'g1']);
  play('p0', 'g+2');
  for (const viewer of ['p0', 'p2', undefined]) {
    assert.deepEqual(leaked(g, g.view(viewer), viewer), [], String(viewer));
  }
  const p1 = g.view('p1').lastPlay!.steps.find(s => s.type === 'draw')!;
  assert.ok(p1.type === 'draw' && p1.cards!.length === 2);
});

test('a challenge shows the hand to the challenger only', () => {
  const { g, act, play } = table(3);
  setHand(g, 'p0', ['W4', 'g1', 'r2']);
  play('p0', 'W4', { color: 'red' });
  const shown = g.player('p0').hand.map(c => c.id);
  act('p1', { type: 'challenge' });
  const forChallenger = g.view('p1').lastPlay!.steps.find(s => s.type === 'challenge')!;
  assert.ok(forChallenger.type === 'challenge');
  assert.deepEqual(forChallenger.hand!.map(c => c.id), shown);
  for (const viewer of ['p0', 'p2', undefined]) {
    const s = g.view(viewer).lastPlay!.steps.find(x => x.type === 'challenge')!;
    assert.ok(s.type === 'challenge' && !('hand' in s), String(viewer));
    assert.equal(s.bluff, true, 'the outcome is public');
  }
});

test('a Wild Draw Four looks the same to everyone whether it is legal or a bluff', () => {
  const views = (second: string) => {
    const { g, play } = table(3);
    setHand(g, 'p0', ['W4', second]);
    play('p0', 'W4', { color: 'blue' });
    return [g.view('p1'), g.view('p2'), g.view()].map(v => JSON.stringify({ ...v, log: v.log.map(l => l.text) }));
  };
  // Legal (no green held) and a bluff (green held): indistinguishable to others.
  assert.deepEqual(views('r1'), views('g1'));
  assert.ok(!views('g1').some(v => v.includes('legal') || v.includes('"check"')));
});

test('views are copies: changing one changes nothing in the game', () => {
  const { g } = table(3);
  const v = g.view('p0');
  const before = JSON.stringify(g.snapshot(), (k, x) => (k === 'savedAt' ? undefined : x));
  v.you!.hand.pop();
  v.you!.hand[0].color = 'red';
  v.top!.value = 99;
  v.players[0].cards = 0;
  v.rules.stacking = true;
  assert.equal(JSON.stringify(g.snapshot(), (k, x) => (k === 'savedAt' ? undefined : x)), before);
});

test('what the viewer may do: playable cards, draw/pass/challenge/call/catch flags', () => {
  const { g, act, tick } = table(3);
  setHand(g, 'p0', ['g1', 'r9', 'b5', 'W']);
  const v = g.view('p0').you!;
  assert.deepEqual(v.playable.sort(), ['g1', 'r9', 'W'].map(s => g.player('p0').hand.find(matcher(s))!.id).sort());
  assert.equal(v.canDraw, true);
  assert.equal(v.canPass, false);
  assert.equal(v.canChallenge, false);
  assert.equal(v.canCallLastCard, false);
  const other = g.view('p1').you!;
  assert.deepEqual(other.playable, [], 'not their turn');
  assert.equal(other.canDraw, false);
  // Down to one card: the call, then (for others, after the grace) the catch.
  setHand(g, 'p0', ['g1', 'g2']);
  assert.equal(g.view('p0').you!.canCallLastCard, true);
  act('p0', { type: 'play', card: g.player('p0').hand[0].id });
  assert.equal(g.view('p0').you!.canCallLastCard, true);
  tick(1_000);
  assert.deepEqual(g.view('p2').you!.canCatch, ['p0']);
  assert.deepEqual(g.view('p0').you!.canCatch, []);
});

test('between rounds and after the match, nobody can act', () => {
  const { g, play } = table(3, { rules: { targetScore: 500 } });
  setHand(g, 'p0', ['g1']);
  play('p0', 'g1');
  const v = g.view('p1');
  assert.equal(v.phase, 'roundOver');
  assert.deepEqual(v.you!.playable, []);
  assert.equal(v.you!.canDraw, false);
  assert.equal(v.pendingDraw, null);
  assert.ok(v.nextRoundAt);
  assert.equal(v.history.length, 1);
});

test('the view carries what the client animates from: lastPlay, seq, deadlines', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['gR', 'g1']);
  const seq = g.view().seq;
  const playSeq = g.view().lastPlay!.seq;
  play('p0', 'gR');
  const v = g.view('p2');
  assert.ok(v.seq > seq);
  assert.equal(v.lastPlay!.seq, playSeq + 1);
  assert.equal(v.lastPlay!.player, 'p0');
  assert.deepEqual(v.lastPlay!.steps.map(s => s.type), ['play', 'reverse']);
  assert.equal(v.direction, -1);
  assert.equal(v.current, 'p2');
  assert.ok(v.log.at(-1)!.play === v.lastPlay!.seq, 'log lines point at the play they came with');
  assert.equal(v.game, 'cards');
});
