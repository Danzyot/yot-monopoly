// Card game rules engine: the deck, the deal and start cards, every card
// effect, Wild Draw Four legality and challenges, drawing and the reshuffle,
// scoring and matches, and refusing bad input without touching the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardsGame, ROUND_BREAK_MS } from '../src/cards/game.ts';
import { CARDS_DECK_SIZE, CARDS_GAME_ID, CARDS_GAME_NAME, LAST_CARD_CALL } from '../../shared/cards/meta.ts';
import {
  CARD_COLORS, bestColor, buildDeck, cardName, cardPoints, handPoints, matches, sameFace,
} from '../../shared/cards/deck.ts';
import { DEFAULT_CARDS_RULES, normalizeCardsRules } from '../../shared/cards/rules.ts';
import type { CardsAction } from '../../shared/cards/types.ts';
import { assertConserved, assertRefused, matcher, putOnTop, setHand, specs, table } from './cardsHelpers.ts';

const find = (spec: string) => buildDeck().find(matcher(spec))!;

// ---- the deck -----------------------------------------------------------------

test('deck: 108 official cards with stable ids and the right points', () => {
  const d = buildDeck();
  assert.equal(d.length, CARDS_DECK_SIZE);
  assert.deepEqual(d.map(c => c.id), Array.from({ length: 108 }, (_, i) => i));
  for (const color of CARD_COLORS) {
    const mine = d.filter(c => c.color === color);
    assert.equal(mine.length, 25, color);
    assert.equal(mine.filter(c => c.kind === 'number' && c.value === 0).length, 1, `${color} 0`);
    for (let v = 1; v <= 9; v++) assert.equal(mine.filter(c => c.kind === 'number' && c.value === v).length, 2, `${color} ${v}`);
    for (const k of ['skip', 'reverse', 'draw2'] as const) assert.equal(mine.filter(c => c.kind === k).length, 2, `${color} ${k}`);
  }
  assert.equal(d.filter(c => c.kind === 'wild' && c.color === null).length, 4);
  assert.equal(d.filter(c => c.kind === 'wild4' && c.color === null).length, 4);
  assert.equal(cardPoints(find('r7')), 7);
  assert.equal(cardPoints(find('r0')), 0);
  for (const s of ['bS', 'bR', 'b+2']) assert.equal(cardPoints(find(s)), 20, s);
  for (const s of ['W', 'W4']) assert.equal(cardPoints(find(s)), 50, s);
  // 4 × (2 × 45 + 6 × 20) + 8 × 50
  assert.equal(handPoints(d), 1240);
});

test('deck: names, matching and identical faces', () => {
  assert.equal(cardName(find('r7')), 'Red 7');
  assert.equal(cardName(find('bS')), 'Blue Skip');
  assert.equal(cardName(find('g+2')), 'Green Draw Two');
  assert.equal(cardName(find('W4')), 'Wild Draw Four');
  const top = find('g9');
  assert.ok(matches(find('g1'), top, 'green'), 'colour');
  assert.ok(matches(find('r9'), top, 'green'), 'number');
  assert.ok(!matches(find('r8'), top, 'green'));
  assert.ok(matches(find('W'), top, 'green') && matches(find('W4'), top, 'green'), 'wilds always');
  assert.ok(matches(find('rS'), find('bS'), 'blue'), 'symbol');
  assert.ok(!matches(find('rS'), find('bR'), 'blue'));
  // A Wild on top: only its named colour (or another Wild) follows.
  assert.ok(matches(find('b2'), find('W'), 'blue'));
  assert.ok(!matches(find('r2'), find('W'), 'blue'));
  assert.ok(sameFace(find('r5'), buildDeck().filter(matcher('r5'))[1]));
  assert.ok(!sameFace(find('r5'), find('b5')));
  assert.ok(!sameFace(find('W'), find('W')), 'Wilds never count as identical');
  assert.equal(bestColor([find('b1'), find('b2'), find('r3'), find('W')]), 'blue');
});

test('naming: the game id and display name live in one place; no trademark in sight', () => {
  assert.equal(CARDS_GAME_ID, 'cards');
  assert.equal(CARDS_GAME_NAME, 'Cards');
  assert.equal(LAST_CARD_CALL, 'Last card!');
});

test('rules: defaults (stacking on, other house rules off), client input normalised', () => {
  assert.equal(DEFAULT_CARDS_RULES.match, 'points');
  assert.equal(DEFAULT_CARDS_RULES.targetScore, 500);
  assert.equal(DEFAULT_CARDS_RULES.stacking, true, 'stacking is how most people play');
  for (const k of ['stackMixed', 'sevenZero', 'jumpIn', 'drawUntilPlayable', 'forcedPlay', 'noBluff'] as const) {
    assert.equal(DEFAULT_CARDS_RULES[k], false, k);
  }
  const r = normalizeCardsRules({ match: 'single', targetScore: 1e9, turnSeconds: 3, stacking: 'yes', jumpIn: true, evil: 1 });
  assert.equal(r.match, 'single');
  assert.equal(r.targetScore, 5000);
  assert.equal(r.turnSeconds, 10);
  assert.equal(r.stacking, true, 'not a boolean: default');
  assert.equal(r.jumpIn, true);
  assert.ok(!('evil' in r));
  assert.deepEqual(normalizeCardsRules(null), DEFAULT_CARDS_RULES);
  assert.equal(normalizeCardsRules({ turnSeconds: 0 }).turnSeconds, 0, '0 = no timer');
});

// ---- the deal -----------------------------------------------------------------

test('deal: 7 each from the dealer\'s left, one card up, the first seat starts', () => {
  const { g } = table(3, { hands: [['r1', 'r2'], ['b1'], ['y1']] });
  assertConserved(g);
  for (const p of g.players) assert.equal(p.hand.length, 7);
  assert.equal(g.pile.length, 108 - 21 - 1);
  assert.deepEqual(specs(g, 'p0').slice(0, 2), ['r1', 'r2'], 'stacked deal');
  assert.equal(g.top!.kind, 'number');
  assert.equal(g.color, 'green');
  assert.equal(g.current.id, 'p0');
  assert.equal(g.players[g.dealerIdx].id, 'p2', 'the first dealer sits last');
  assert.equal(g.phase, 'play');
  assert.equal(g.direction, 1);
  assert.equal(g.round, 1);
  const steps = g.lastPlay!.steps;
  assert.deepEqual(steps[0], { type: 'deal', round: 1, dealer: 'p2', order: ['p0', 'p1', 'p2'], count: 7 });
  assert.equal(steps[1].type, 'flip');
  assert.match(g.log[0].text, /Round 1 — P2 deals 7 cards each\. First card: Green 9\./);
  assert.throws(() => new CardsGame({ players: [{ id: 'a', name: 'A', isBot: false }] }), /at least 2/);
  assert.throws(() => new CardsGame({ players: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, name: `${i}`, isBot: false })) }), /At most 10/);
  assert.throws(() => new CardsGame({ players: [{ id: 'a', name: 'A', isBot: false }, { id: 'a', name: 'B', isBot: false }] }), /Duplicate/);
});

test('start card: a Wild Draw Four goes back into the deck and another is turned up', () => {
  const { g } = table(3, { flip: ['W4', 'W4', 'b3'] });
  assertConserved(g);
  assert.equal(cardName(g.top!), 'Blue 3');
  assert.equal(g.discard.length, 1);
  const flips = g.lastPlay!.steps.filter(s => s.type === 'flip');
  assert.deepEqual(flips.map(s => s.type === 'flip' && [s.card.kind, !!s.back]), [['wild4', true], ['wild4', true], ['number', false]]);
  assert.equal(g.pile.filter(c => c.kind === 'wild4').length, 4, 'both back in the pile');
  assert.equal(g.current.id, 'p0');
  assert.equal(g.color, 'blue');
});

test('start card: Wild — the first player names the colour, then plays', () => {
  const { g, act, play } = table(3, { flip: ['W'], hands: [['b1', 'r2']] });
  assert.equal(g.phase, 'color');
  assert.equal(g.color, null);
  assert.equal(g.current.id, 'p0');
  assertRefused(g, () => play('p0', 'b1'), /Pick a colour first/);
  assertRefused(g, () => act('p1', { type: 'chooseColor', color: 'red' }), /Not your turn/);
  act('p0', { type: 'chooseColor', color: 'blue' });
  assert.equal(g.color, 'blue');
  assert.equal(g.phase, 'play');
  assert.equal(g.current.id, 'p0', 'still their turn');
  play('p0', 'b1');
  assert.equal(g.current.id, 'p1');
});

test('start card: Skip — the first player is skipped', () => {
  const { g } = table(3, { flip: ['rS'] });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.color, 'red');
  assert.ok(g.lastPlay!.steps.some(s => s.type === 'skip' && s.player === 'p0'));
});

test('start card: Reverse — play goes the other way and the dealer starts', () => {
  const { g, play } = table(3, { flip: ['rR'], hands: [[], [], ['r3']] });
  assert.equal(g.direction, -1);
  assert.equal(g.current.id, 'p2', 'the dealer');
  play('p2', 'r3');
  assert.equal(g.current.id, 'p1', 'then to the dealer\'s right');
  // Two players: the dealer starts too.
  const two = table(2, { flip: ['bR'] });
  assert.equal(two.g.current.id, 'p1');
});

test('start card: Draw Two — the first player draws 2 and is skipped', () => {
  const { g } = table(3, { flip: ['r+2'], draws: ['b1', 'b2'] });
  assert.equal(g.player('p0').hand.length, 9);
  assert.deepEqual(specs(g, 'p0').slice(7), ['b1', 'b2']);
  assert.equal(g.current.id, 'p1');
  const draw = g.lastPlay!.steps.find(s => s.type === 'draw');
  assert.deepEqual(draw && draw.type === 'draw' && [draw.player, draw.count, draw.reason], ['p0', 2, 'start']);
  assertConserved(g);
});

// ---- playing cards ---------------------------------------------------------------

test('play: match by colour or number; anything else (or out of turn) is refused untouched', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g3', 'r9', 'b5']);
  setHand(g, 'p1', ['r4', 'b9']);
  assertRefused(g, () => play('p0', 'b5'), /Blue 5 does not match/);
  assertRefused(g, () => play('p1', 'b9'), /Not your turn/);
  assertRefused(g, () => g.apply('p0', { type: 'play', card: g.player('p1').hand[0].id }), /do not have/);
  play('p0', 'r9');
  assert.equal(g.color, 'red', 'a number match changes the colour');
  assert.equal(g.current.id, 'p1');
  play('p1', 'r4');
  assert.equal(g.current.id, 'p2');
  assert.equal(g.discard.length, 3);
  assert.deepEqual(g.lastPlay!.steps, [{ type: 'play', player: 'p1', card: g.top, from: 'hand' }]);
  assert.match(g.log.at(-1)!.text, /P1 plays Red 4\./);
  assertConserved(g);
});

test('Skip: the next player misses their turn (two players: you go again)', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['gS', 'g1']);
  play('p0', 'gS');
  assert.equal(g.current.id, 'p2');
  assert.ok(g.lastPlay!.steps.some(s => s.type === 'skip' && s.player === 'p1'));
  const two = table(2);
  setHand(two.g, 'p0', ['gS', 'g1']);
  two.play('p0', 'gS');
  assert.equal(two.g.current.id, 'p0');
});

test('Reverse: play changes direction', () => {
  const { g, play } = table(4);
  setHand(g, 'p0', ['gR', 'g1']);
  setHand(g, 'p3', ['g2', 'g3']);
  play('p0', 'gR');
  assert.equal(g.direction, -1);
  assert.equal(g.current.id, 'p3');
  play('p3', 'g2');
  assert.equal(g.current.id, 'p2');
  assert.ok(g.lastPlay!.steps.length === 1);
});

test('Reverse with two players acts like a Skip', () => {
  const { g, play } = table(2);
  setHand(g, 'p0', ['gR', 'g1']);
  play('p0', 'gR');
  assert.equal(g.current.id, 'p0', 'the same player goes again');
  const types = g.lastPlay!.steps.map(s => s.type);
  assert.deepEqual(types, ['play', 'reverse', 'skip']);
  assert.match(g.log.at(-1)!.text, /P1 is skipped/);
});

test('Draw Two: the next player draws 2 and misses their turn', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g+2', 'g1']);
  putOnTop(g, 'b1', 'b2');
  play('p0', 'g+2');
  assert.equal(g.player('p1').hand.length, 9);
  assert.deepEqual(specs(g, 'p1').slice(7), ['b1', 'b2']);
  assert.equal(g.current.id, 'p2');
  assert.equal(g.pending, null);
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'draw', 'skip']);
  assert.ok(g.log.some(l => l.text === 'P1 draws 2 and misses a turn.' && l.amount === 2 && l.reason === 'penalty'));
  assertConserved(g);
});

test('Wild: name the colour with the play, or be asked for it', () => {
  const { g, act, play } = table(3);
  setHand(g, 'p0', ['W', 'g1']);
  play('p0', 'W', { color: 'blue' });
  assert.equal(g.color, 'blue');
  assert.equal(g.current.id, 'p1');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'color']);

  setHand(g, 'p1', ['W', 'b1']);
  play('p1', 'W');
  assert.equal(g.phase, 'color');
  assert.equal(g.current.id, 'p1');
  assertRefused(g, () => act('p1', { type: 'chooseColor', color: 'purple' as never }), /No such colour/);
  assertRefused(g, () => act('p2', { type: 'chooseColor', color: 'red' }), /Not your turn/);
  assertRefused(g, () => act('p1', { type: 'draw' }), /Can't do that now/);
  act('p1', { type: 'chooseColor', color: 'red' });
  assert.equal(g.color, 'red');
  assert.equal(g.current.id, 'p2');
  assertRefused(g, () => g.apply('p2', { type: 'play', card: g.player('p2').hand[0].id, color: 'pink' as never }));
});

test('Wild Draw Four: legal play, the next player takes 4 and misses a turn', () => {
  const { g, act, play } = table(3);
  setHand(g, 'p0', ['W4', 'r1', 'b2']); // no green: legal
  play('p0', 'W4', { color: 'blue' });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.phase, 'play');
  const v = g.view('p1');
  assert.deepEqual(v.pendingDraw, { amount: 4, kind: 'wild4', from: 'p0', challengeable: true, prevColor: 'green' });
  assert.equal(v.you!.canChallenge, true);
  assert.deepEqual(v.you!.playable, [], 'nothing stacks without the house rule');
  assertRefused(g, () => g.apply('p1', { type: 'play', card: g.player('p1').hand[0].id }), /You must draw 4 or challenge/);
  act('p1', { type: 'draw' });
  assert.equal(g.player('p1').hand.length, 11);
  assert.equal(g.current.id, 'p2');
  assert.equal(g.color, 'blue');
  assert.equal(g.pending, null);
});

test('Wild Draw Four challenge: legal — the challenger draws 6 and misses a turn', () => {
  const { g, act, play } = table(3);
  // Legality is about the colour only: holding a matching number of another colour is fine.
  setHand(g, 'p0', ['W4', 'r1', 'b9']);
  play('p0', 'W4', { color: 'red' });
  act('p1', { type: 'challenge' });
  assert.equal(g.player('p1').hand.length, 13);
  assert.equal(g.player('p0').hand.length, 2);
  assert.equal(g.current.id, 'p2');
  assert.equal(g.color, 'red');
  const ch = g.lastPlay!.steps.find(s => s.type === 'challenge')!;
  assert.ok(ch.type === 'challenge' && !ch.bluff && ch.target === 'p0');
  assert.ok(g.log.some(l => /it was legal\. P1 draws 6 and misses a turn/.test(l.text) && l.amount === 6 && l.reason === 'challenge'));
  assertRefused(g, () => act('p2', { type: 'challenge' }), /nothing to challenge/);
  assertConserved(g);
});

test('Wild Draw Four challenge: a bluff — its player draws 4 and the challenger plays on', () => {
  const { g, act, play } = table(3);
  setHand(g, 'p0', ['W4', 'g1', 'r2']); // holds green: illegal
  setHand(g, 'p1', ['r5', 'b6']);
  play('p0', 'W4', { color: 'red' });
  assert.equal(g.view('p1').pendingDraw!.challengeable, true, 'nobody can tell it is a bluff');
  act('p1', { type: 'challenge' });
  assert.equal(g.player('p0').hand.length, 6);
  assert.equal(g.player('p1').hand.length, 2, 'the challenger draws nothing');
  assert.equal(g.current.id, 'p1');
  assert.equal(g.phase, 'play');
  assert.equal(g.color, 'red', 'the named colour stands');
  assert.ok(g.log.some(l => /a bluff \(P0 held Green\)\. P0 draws 4/.test(l.text)));
  act('p1', { type: 'play', card: g.player('p1').hand.find(matcher('r5'))!.id });
  assert.equal(g.current.id, 'p2');
});

test('Wild Draw Four without a colour: asked first, then the next player decides', () => {
  const { g, act, play } = table(3);
  setHand(g, 'p0', ['W4', 'g1']);
  play('p0', 'W4');
  assert.equal(g.phase, 'color');
  act('p0', { type: 'chooseColor', color: 'yellow' });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.pending!.amount, 4);
  act('p1', { type: 'challenge' });
  assert.equal(g.player('p0').hand.length, 5, 'held green: a bluff');
});

// ---- drawing --------------------------------------------------------------------

test('draw: an unplayable card ends the turn; a playable one may be played or kept', () => {
  const { g, act, play, card } = table(3);
  setHand(g, 'p0', ['r1', 'b2']);
  putOnTop(g, 'r4', 'g2');
  act('p0', { type: 'draw' });
  assert.equal(g.player('p0').hand.length, 3);
  assert.equal(g.current.id, 'p1', 'Red 4 does not match: turn over');
  assert.match(g.log.at(-1)!.text, /P0 draws a card\./);

  setHand(g, 'p1', ['b9', 'r3']);
  act('p1', { type: 'draw' });
  assert.equal(g.phase, 'drawn', 'Green 2 matches');
  assert.equal(g.drawnCard, card('p1', 'g2'));
  assert.equal(g.view('p1').you!.drawn, g.drawnCard);
  assertRefused(g, () => play('p1', 'b9'), /only play the card you just drew/);
  assertRefused(g, () => act('p1', { type: 'draw' }), /Can't do that now/);
  play('p1', 'g2');
  assert.equal(g.current.id, 'p2');
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type === 'play' && s.from), ['drawn']);

  setHand(g, 'p2', ['r7']);
  putOnTop(g, 'g4');
  act('p2', { type: 'draw' });
  act('p2', { type: 'pass' });
  assert.equal(g.current.id, 'p0');
  assert.equal(g.player('p2').hand.length, 2);
  assertRefused(g, () => act('p0', { type: 'pass' }), /Can't do that now/);
  assertConserved(g);
});

test('reshuffle: an empty draw pile is rebuilt from the discards, keeping the top card', () => {
  const { g, act } = table(3);
  setHand(g, 'p0', ['b1']);
  // Everything still face down goes under the top card.
  const top = g.top!;
  g.discard = [...g.pile, top];
  g.pile = [];
  assertConserved(g);
  act('p0', { type: 'draw' });
  assert.equal(g.discard.length, 1);
  assert.equal(g.top, top, 'top card stays');
  assert.equal(g.player('p0').hand.length, 2);
  assert.equal(g.pile.length, 108 - 14 - 2 - 1);
  const types = g.lastPlay!.steps.map(s => s.type);
  assert.deepEqual(types.slice(0, 2), ['reshuffle', 'draw']);
  assert.ok(g.log.some(l => /draw pile ran out — 92 discards were shuffled/.test(l.text)));
  assertConserved(g);
});

test('reshuffle mid-penalty: the draw continues from the new pile', () => {
  const { g, play } = table(3);
  setHand(g, 'p0', ['g+2', 'g1']);
  // One card left in the pile; the rest are discards under the top.
  const keep = g.pile.pop()!;
  g.discard = [...g.pile, ...g.discard];
  g.pile = [keep];
  play('p0', 'g+2');
  assert.equal(g.player('p1').hand.length, 9);
  assert.deepEqual(g.lastPlay!.steps.map(s => s.type), ['play', 'draw', 'reshuffle', 'draw', 'skip']);
  assertConserved(g);
});

test('nothing left to draw: the turn simply passes', () => {
  const { g, act } = table(3);
  setHand(g, 'p0', ['r1']);
  // Hand the whole pile to p2 (and nothing under the top card).
  g.player('p2').hand.push(...g.pile);
  g.pile = [];
  act('p0', { type: 'draw' });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.player('p0').hand.length, 1);
  assert.match(g.log.at(-1)!.text, /nothing to draw and passes/);
  assertConserved(g);
});

// ---- scoring ------------------------------------------------------------------------

test('scoring: going out wins the round; the winner scores everyone else\'s cards', () => {
  const { g, play } = table(3, { rules: { match: 'single' } });
  setHand(g, 'p0', ['g5']);
  setHand(g, 'p1', ['r5', 'bS', 'W', 'W4', 'y+2', 'g0', 'b9']); // 5+20+50+50+20+0+9 = 154
  setHand(g, 'p2', ['r1', 'bR']); // 21
  play('p0', 'g5');
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  assert.equal(g.player('p0').score, 175);
  assert.deepEqual(g.history, [{ round: 1, winner: 'p0', points: 175, hands: { p1: 154, p2: 21 }, cards: { p1: 7, p2: 2 } }]);
  const end = g.lastPlay!.steps.at(-1)!;
  assert.deepEqual(end, { type: 'roundEnd', winner: 'p0', points: 175, matchOver: true });
  assert.ok(g.log.some(l => /P0 is out of cards and wins round 1, scoring 175 points\./.test(l.text) && l.amount === 175));
  assertRefused(g, () => g.apply('p1', { type: 'draw' }), /The game is over/);
  assert.equal(g.clockDeadline(), null);
});

test('scoring: a Draw card played to go out still lands, and counts', () => {
  const { g, play } = table(2, { rules: { match: 'single' } });
  setHand(g, 'p0', ['g+2']);
  setHand(g, 'p1', ['r5']);
  putOnTop(g, 'r1', 'b2');
  play('p0', 'g+2');
  assert.equal(g.player('p1').hand.length, 3);
  assert.equal(g.player('p0').score, 8);
});

test('points match: rounds continue until someone reaches the target; dealer moves left', () => {
  const { g, play, tick, now } = table(3, { rules: { match: 'points', targetScore: 200 } });
  setHand(g, 'p0', ['g5']);
  setHand(g, 'p1', ['W', 'W4']); // 100
  setHand(g, 'p2', ['r1']);
  play('p0', 'g5');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('p0').score, 101);
  assert.equal(g.nextRoundAt, now() + ROUND_BREAK_MS);
  assert.equal(g.clockDeadline(), g.nextRoundAt);
  assertRefused(g, () => g.apply('p1', { type: 'draw' }), /next deal is coming/);
  assert.match(g.log.at(-1)!.text, /\(101 in all\)/);
  tick(ROUND_BREAK_MS - 1);
  assert.equal(g.clockTimeout(), false);
  tick(1);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.round, 2);
  assert.ok(['play', 'color'].includes(g.view().phase));
  assert.equal(g.players[g.dealerIdx].id, 'p0', 'the deal passes to the left');
  for (const p of g.players) assert.ok(p.hand.length >= 7);
  assert.equal(g.player('p0').score, 101, 'scores carry over');
  assert.equal(g.lastPlay!.steps[0].type, 'deal');
  assertConserved(g);

  // Second round: p1 goes out with plenty against them.
  g.phase = 'play';
  g.currentIdx = 1;
  g.color = g.top!.color ?? 'red';
  setHand(g, 'p1', ['W']);
  setHand(g, 'p0', ['W4', 'W4', 'W4', 'W4']);
  play('p1', 'W', { color: 'red' });
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p1');
  assert.equal(g.player('p1').score, 200 + handPoints(g.player('p2').hand));
  assert.match(g.log.at(-1)!.text, /P1 wins the match with \d+ points!/);
  assert.equal(g.history.length, 2);
});

test('startNextRound deals at once, and only between rounds', () => {
  const { g, play } = table(2, { rules: { targetScore: 500 } });
  assertRefused(g, () => g.startNextRound(), /not over/);
  setHand(g, 'p0', ['g5']);
  play('p0', 'g5');
  g.startNextRound();
  assert.equal(g.round, 2);
  assert.equal(g.nextRoundAt, null);
});

// ---- bad input --------------------------------------------------------------------

test('bad input is refused and leaves the game untouched', () => {
  const { g } = table(3);
  setHand(g, 'p0', ['g1', 'W']);
  const id = g.player('p0').hand[0].id;
  const junk: [string, unknown, RegExp?][] = [
    ['p0', null, /Bad action/],
    ['p0', 'play', /Bad action/],
    ['p0', { type: 'nope' }, /Unknown action/],
    ['p0', { type: 'play' }, /No such card/],
    ['p0', { type: 'play', card: String(id) }, /No such card/],
    ['p0', { type: 'play', card: id + 0.5 }, /No such card/],
    ['p0', { type: 'play', card: 999 }, /do not have/],
    ['p0', { type: 'play', card: id, target: 'p0' }, /yourself/],
    ['p0', { type: 'play', card: id, target: 'ghost' }, /Unknown player/],
    ['p0', { type: 'play', card: id, target: 'x'.repeat(100) }, /Unknown player/],
    ['p0', { type: 'chooseColor', color: 'red' }, /Can't do that now/],
    ['p0', { type: 'swap', target: 'p1' }, /Can't do that now/],
    ['p0', { type: 'pass' }, /Can't do that now/],
    ['p0', { type: 'catch', target: 'p1' }, /not down to one card/],
    ['p0', { type: 'catch', target: 42 }, /Unknown player/],
    ['p0', { type: 'callLastCard' }, undefined],
    ['ghost', { type: 'draw' }, /Unknown player/],
    ['p1', { type: 'draw' }, /Not your turn/],
  ];
  for (const [who, a, msg] of junk) {
    if ((a as CardsAction | null)?.type === 'callLastCard') continue; // legal with two cards (see the last-card tests)
    assertRefused(g, () => g.apply(who, a as CardsAction), msg);
  }
  assertConserved(g);
});

test('the same seed deals the same game', () => {
  const run = (seed: number) => {
    let s = seed;
    const g = new CardsGame({
      players: [{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: false }],
      rng: n => (s = (s * 1103515245 + 12345) % 2147483648) % n,
      now: () => 0,
    });
    return JSON.stringify(g.snapshot());
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});
