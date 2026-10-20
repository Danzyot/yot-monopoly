// Chog Chaos: its deck (the 108 plus Purge, Blitz, Gas Spike +6, Rug Pull
// +10 and Chog Roulette), what each new card does, stacking by size, the
// Mercy rule (knocked out at 25 cards, last one standing), snapshots, and the
// bot playing every new card sensibly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardsGame } from '../src/cards/game.ts';
import { cardsBotAction } from '../src/cards/bot.ts';
import { CARDS_CHAOS_DECK_SIZE, CARDS_DECK_SIZE, CARDS_MERCY_LIMIT } from '../../shared/cards/meta.ts';
import { buildDeck, cardName, cardPoints, handPoints, isWild, matches, type Card } from '../../shared/cards/deck.ts';
import { CARDS_MODES, DEFAULT_CARDS_RULES, normalizeCardsRules } from '../../shared/cards/rules.ts';
import { tableLabel } from '../../shared/cards/room.ts';
import { cardsPlayMs } from '../../shared/cards/pacing.ts';
import type { CardsAction } from '../../shared/cards/types.ts';
import { assertConserved, assertRefused, putOnTop, setHand, setTop, specs, table } from './cardsHelpers.ts';

const CHAOS = { mode: 'chaos' } as const;
const STACKING = { mode: 'chaos', stacking: true, stackMixed: true } as const;
const BOTS = { 0: 'normal', 1: 'normal', 2: 'normal' } as const;

/** Hand `id` this many more cards straight off the draw pile (no draw step: a position, not a play). */
function bulk(g: CardsGame, id: string, n: number) {
  g.player(id).hand.push(...g.pile.splice(0, n));
}

function playOf(a: CardsAction | null) {
  assert.ok(a && a.type === 'play', `expected a play, got ${JSON.stringify(a)}`);
  return a;
}

const stepTypes = (g: CardsGame) => g.lastPlay!.steps.map(s => s.type);

test('Chog Chaos deck: the 108 keep their ids, then 27 new cards with names, points and matching', () => {
  const classic = buildDeck();
  const chaos = buildDeck('chaos');
  assert.equal(classic.length, CARDS_DECK_SIZE);
  assert.equal(chaos.length, CARDS_CHAOS_DECK_SIZE);
  assert.deepEqual(chaos.slice(0, CARDS_DECK_SIZE), classic, 'a Classic card has the same id in both decks');
  assert.deepEqual(chaos.map(c => c.id), Array.from({ length: CARDS_CHAOS_DECK_SIZE }, (_, i) => i));
  const count = (k: Card['kind']) => chaos.filter(c => c.kind === k).length;
  assert.deepEqual([count('purge'), count('blitz'), count('wild6'), count('wild10'), count('roulette')], [8, 8, 4, 3, 4]);
  for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
    assert.equal(chaos.filter(c => c.color === color && c.kind === 'purge').length, 2);
    assert.equal(chaos.filter(c => c.color === color && c.kind === 'blitz').length, 2);
  }
  const one = (k: Card['kind'], color: Card['color'] = null) => chaos.find(c => c.kind === k && c.color === color)!;
  assert.equal(cardName(one('purge', 'red')), 'Red Purge');
  assert.equal(cardName(one('blitz', 'blue')), 'Blue Blitz');
  assert.equal(cardName(one('wild6')), 'Gas Spike +6');
  assert.equal(cardName(one('wild10')), 'Rug Pull +10');
  assert.equal(cardName(one('roulette')), 'Chog Roulette');
  for (const k of ['wild6', 'wild10', 'roulette'] as const) {
    assert.ok(isWild(one(k)), `${k} is a Wild`);
    assert.equal(cardPoints(one(k)), 60);
  }
  assert.equal(cardPoints(one('purge', 'green')), 30);
  assert.equal(cardPoints(one('blitz', 'green')), 30);
  // Coloured: by colour, or the same card in another colour.
  assert.ok(matches(one('purge', 'red'), one('purge', 'blue'), 'blue'));
  assert.ok(matches(one('blitz', 'red'), one('number', 'red'), 'red'));
  assert.ok(!matches(one('blitz', 'red'), one('purge', 'blue'), 'blue'));
  assert.ok(matches(one('wild10'), one('number', 'red'), 'red'));
  assert.equal(new CardsGame({ players: [{ id: 'a', name: 'A', isBot: true }, { id: 'b', name: 'B', isBot: true }], rules: CHAOS }).deckSize, 135);
});

test('rules: Classic by default; the mode and Mercy normalised; each mode has its preset', () => {
  assert.equal(DEFAULT_CARDS_RULES.mode, 'classic');
  assert.equal(DEFAULT_CARDS_RULES.mercy, false);
  assert.equal(normalizeCardsRules({ mode: 'chaos' }).mode, 'chaos');
  assert.equal(normalizeCardsRules({ mode: 'mayhem' }).mode, 'classic');
  assert.equal(normalizeCardsRules({ mercy: 'yes' }).mercy, false);
  const chaos = CARDS_MODES.find(m => m.id === 'chaos')!;
  assert.deepEqual([chaos.preset.stacking, chaos.preset.stackMixed, chaos.preset.sevenZero, chaos.preset.drawUntilPlayable, chaos.preset.mercy],
    [true, true, true, true, true]);
  const classic = CARDS_MODES.find(m => m.id === 'classic')!;
  for (const [k, v] of Object.entries(classic.preset)) assert.equal(v, DEFAULT_CARDS_RULES[k as keyof typeof classic.preset], k);
  assert.equal(tableLabel({ ...DEFAULT_CARDS_RULES, match: 'single' }), 'Single round');
  assert.equal(tableLabel({ ...DEFAULT_CARDS_RULES, mode: 'chaos' }), 'Chog Chaos · First to 500');
});

test('a round never starts on a Chog Chaos card: it goes back like a Wild Draw Four', () => {
  const { g } = table(3, { rules: CHAOS, flip: ['rP', 'W10', 'WR', 'g9'] });
  const flips = g.lastPlay!.steps.filter(s => s.type === 'flip');
  assert.deepEqual(flips.map(s => s.type === 'flip' && [s.card.kind, !!s.back]), [['purge', true], ['wild10', true], ['roulette', true], ['number', false]]);
  assert.equal(g.top!.kind, 'number');
  assert.ok(g.log.some(e => e.text === 'A Rug Pull +10 turned up — it goes back and the pile is reshuffled.'));
  assertConserved(g);
});

test('Purge: every other card of its colour goes down with it, under it', () => {
  const { g, play } = table(3, { rules: CHAOS });
  setHand(g, 'p0', ['gP', 'g1', 'g5', 'gS', 'r3', 'W']);
  play('p0', 'gP');
  assert.deepEqual(specs(g, 'p0'), ['r3', 'W'], 'the Wild is no colour: it stays');
  assert.equal(g.top!.kind, 'purge');
  assert.deepEqual(g.discard.slice(-4, -1).map(c => c.kind === 'number' ? `${c.value}` : c.kind), ['1', '5', 'skip'], 'the purged cards lie under it');
  assert.deepEqual(stepTypes(g), ['purge', 'play'], 'they go down first, then the Purge lands on them');
  const purge = g.lastPlay!.steps[0];
  assert.ok(purge.type === 'purge' && purge.cards.length === 3);
  // The purged cards are face up: everyone sees them.
  const seen = g.view('p2').lastPlay!.steps[0];
  assert.ok(seen.type === 'purge' && seen.cards.length === 3);
  assert.equal(g.current.id, 'p1', 'a Purge does nothing else: play moves on (the Skip it cleared does not count)');
  assert.equal(g.color, 'green');
  assert.ok(g.log.some(e => e.text === '🌀 Purge! 3 more Green cards go with it.'));
  assertConserved(g);
});

test('Purge: down to one card calls with the play; clearing the whole hand goes out', () => {
  const a = table(3, { rules: CHAOS });
  setHand(a.g, 'p0', ['bP', 'b1', 'b2', 'r2']);
  setTop(a.g, 'b4');
  a.play('p0', 'bP', { callLastCard: true });
  assert.deepEqual(specs(a.g, 'p0'), ['r2']);
  assert.notEqual(a.g.oneCard.p0?.calledAt, null, 'the call counted: the Purge left one card');

  const b = table(3, { rules: CHAOS });
  setHand(b.g, 'p0', ['rP', 'r1', 'r9']);
  setTop(b.g, 'r4');
  b.play('p0', 'rP');
  assert.equal(b.g.phase, 'roundOver');
  assert.equal(b.g.history[0].winner, 'p0');
  assertConserved(b.g);
});

test('"Last card!" may be called ahead of a Purge that will leave one card', () => {
  const { g, act, play } = table(3, { rules: CHAOS });
  setHand(g, 'p0', ['gP', 'g1', 'g2', 'g3', 'r2']);
  assert.equal(g.view('p0').you!.canCallLastCard, true, 'the Purge would leave the red 2 alone');
  act('p0', { type: 'callLastCard' });
  assert.equal(g.view('p0').you!.preCalled, true);
  play('p0', 'gP');
  assert.deepEqual(specs(g, 'p0'), ['r2']);
  assert.notEqual(g.oneCard.p0.calledAt, null, 'the call counted');
  const off = table(3, { rules: CHAOS });
  setHand(off.g, 'p0', ['gP', 'g1', 'r2', 'r3']);
  assert.equal(off.g.view('p0').you!.canCallLastCard, false, 'two would be left');
  assertRefused(off.g, () => off.act('p0', { type: 'callLastCard' }), /down to one card/);
});

test('Blitz: everyone else is skipped, the same player goes again (a fresh step)', () => {
  for (const n of [2, 4]) {
    const { g, play } = table(n, { rules: CHAOS });
    setHand(g, 'p0', ['gB', 'g1', 'r2']);
    const turn = g.turn;
    play('p0', 'gB');
    assert.equal(g.current.id, 'p0', `${n} players`);
    assert.equal(g.phase, 'play');
    assert.ok(g.turn > turn, 'a new step: a fresh turn clock');
    assert.deepEqual(stepTypes(g), ['play', 'blitz']);
    play('p0', 'g1');
    assert.equal(g.current.id, 'p1');
  }
});

test('Gas Spike and Rug Pull: Wilds that make the next player draw 6 and 10, never challengeable', () => {
  const { g, act, play } = table(3, { rules: CHAOS }); // stacking off: it lands at once
  setHand(g, 'p0', ['W6', 'g1']);
  const n1 = g.player('p1').hand.length;
  play('p0', 'W6', { color: 'blue' });
  assert.equal(g.player('p1').hand.length, n1 + 6);
  assert.equal(g.current.id, 'p2', 'and misses the turn');
  assert.equal(g.color, 'blue');
  setHand(g, 'p2', ['W10', 'b1']);
  play('p2', 'W10');
  assert.equal(g.phase, 'color', 'no colour given: asked for one');
  act('p2', { type: 'chooseColor', color: 'red' });
  assert.equal(g.player('p0').hand.length, 1 + 10);
  assert.equal(g.current.id, 'p1');

  const s = table(3, { rules: STACKING });
  setHand(s.g, 'p0', ['W6', 'g1']);
  s.play('p0', 'W6', { color: 'red' });
  const pd = s.g.view('p1').pendingDraw!;
  assert.equal(pd.amount, 6);
  assert.equal(pd.challengeable, false, 'only a lone Wild Draw Four can be challenged');
  assertRefused(s.g, () => s.act('p1', { type: 'challenge' }), /nothing to challenge/);
});

test('stacking by size: a Draw card answers any of equal or lower value; a stack step counts the chain', () => {
  const { g, act, play } = table(4, { rules: STACKING });
  setHand(g, 'p0', ['g+2', 'g1']);
  setHand(g, 'p1', ['W6', 'r2']);
  setHand(g, 'p2', ['b+2', 'W4', 'W10', 'r3']);
  setHand(g, 'p3', ['W4', 'W6', 'y1']);
  play('p0', 'g+2');
  play('p1', 'W6', { color: 'red' });
  assert.deepEqual(g.lastPlay!.steps.find(s => s.type === 'stack'), { type: 'stack', player: 'p1', amount: 8, chain: 2 });
  assert.deepEqual(g.view('p2').you!.playable.length, 1, 'only the Rug Pull: a +2 or +4 is smaller than +6');
  assertRefused(g, () => play('p2', 'b+2'), /Stack a Draw card/);
  assertRefused(g, () => play('p2', 'W4', { color: 'red' }), /Stack a Draw card/);
  play('p2', 'W10', { color: 'green' });
  assert.equal(g.pending!.amount, 18);
  assert.equal(g.view('p3').pendingDraw!.chain, 3);
  assertRefused(g, () => play('p3', 'W6', { color: 'red' }), /Stack a Draw card/);
  const n = g.player('p3').hand.length;
  act('p3', { type: 'draw' });
  assert.equal(g.player('p3').hand.length, n + 18);
  assert.ok(g.log.some(e => e.text === '🔥 Stacked! The penalty is up to 18.'));
  assertConserved(g);

  // Without mixed stacking: the same card only.
  const same = table(3, { rules: { mode: 'chaos', stacking: true } });
  setHand(same.g, 'p0', ['g+2', 'g1']);
  setHand(same.g, 'p1', ['W6', 'r+2', 'r2']);
  same.play('p0', 'g+2');
  assertRefused(same.g, () => same.play('p1', 'W6', { color: 'red' }), /Stack a Draw card/);
  same.play('p1', 'r+2');
  assert.equal(same.g.pending!.amount, 4);
});

test('Classic mixed stacking is unchanged by the Chog Chaos rules', () => {
  const { g, play } = table(3, { rules: { stacking: true, stackMixed: true } });
  setHand(g, 'p0', ['W4', 'g1']);
  setHand(g, 'p1', ['r+2', 'b+2', 'r3']);
  play('p0', 'W4', { color: 'red' });
  assertRefused(g, () => play('p1', 'b+2'), /Stack a Draw card/);
  play('p1', 'r+2');
  assert.equal(g.pending!.amount, 6, 'a Draw Two in the named colour goes on a Draw Four in Classic');
});

test('a Rug Pull as the last card: the next player still draws 10, then the round is scored', () => {
  const { g, play } = table(3, { rules: CHAOS });
  setHand(g, 'p0', ['W10']);
  const n = g.player('p1').hand.length;
  play('p0', 'W10', { color: 'red' });
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('p1').hand.length, n + 10);
  assert.equal(g.history[0].hands.p1, handPoints(g.player('p1').hand));
  assertConserved(g);
});

test('Chog Roulette: the next player turns up cards until the colour shows (Wilds do not count), keeps them, misses the turn', () => {
  const { g, act, play } = table(3, { rules: CHAOS });
  setHand(g, 'p0', ['WR', 'g1']);
  putOnTop(g, 'W', 'g2', 'b5', 'r7', 'r1');
  const n = g.player('p1').hand.length;
  play('p0', 'WR');
  assert.equal(g.phase, 'color');
  act('p0', { type: 'chooseColor', color: 'red' });
  assert.equal(g.player('p1').hand.length, n + 4, 'the Wild, green 2, blue 5 and the red 7: it stops at the first red');
  assert.deepEqual(specs(g, 'p1').slice(-4), ['W', 'g2', 'b5', 'r7']);
  assert.equal(g.pile.at(-1)!.color, 'red', 'the red 1 is still on the pile');
  assert.equal(g.current.id, 'p2', 'they miss the turn');
  assert.equal(g.color, 'red');
  assert.deepEqual(stepTypes(g), ['color', 'roulette', 'draw', 'skip']);
  const draw = g.lastPlay!.steps[2];
  assert.ok(draw.type === 'draw' && draw.reason === 'roulette' && draw.count === 4);
  assert.ok(g.log.some(e => e.text.startsWith('🎰 Chog Roulette! P1 turns up 4 cards before Red shows')));
  assert.ok(cardsPlayMs(g.lastPlay!.steps) > 0);
  assertConserved(g);
});

test('Chog Roulette on a timeout: the colour is picked for the player and the wheel still spins', () => {
  const { g, tick, play } = table(3, { rules: { ...CHAOS, turnSeconds: 20 } });
  setHand(g, 'p0', ['WR', 'b1', 'b2']);
  play('p0', 'WR');
  assert.equal(g.phase, 'color');
  tick(21_000);
  assert.ok(g.clockTimeout());
  assert.equal(g.color, 'blue');
  assert.equal(g.current.id, 'p2');
  assert.ok(g.lastPlay!.steps.some(s => s.type === 'roulette'));
});

test('Mercy: 25 cards knocks a player out of the round; their cards go under the pile and still count', () => {
  const { g, act, play } = table(3, { rules: { ...STACKING, mercy: true, targetScore: 5000 } });
  setHand(g, 'p0', ['W6', 'g1', 'g2']);
  bulk(g, 'p1', 16); // 23
  play('p0', 'W6', { color: 'green' });
  const owed = handPoints(g.player('p1').hand);
  const pileBefore = g.pile.length;
  act('p1', { type: 'draw' }); // takes 6: 29
  const p1 = g.player('p1');
  assert.equal(p1.out, true);
  assert.equal(p1.hand.length, 0);
  assert.equal(g.pile.length, pileBefore - 6 + 29, 'the 29 went under the pile');
  const mercy = g.lastPlay!.steps.find(s => s.type === 'mercy');
  assert.deepEqual(mercy, { type: 'mercy', player: 'p1', count: 29 });
  assert.ok(g.log.some(e => e.text === '💥 P1 hits 29 cards — no mercy! Out of round 1.'));
  assert.equal(g.view('p0').players[1].out, true);
  assertConserved(g);

  // Play goes round without them; they cannot be swapped with or caught.
  assert.equal(g.current.id, 'p2');
  setHand(g, 'p2', ['g3', 'g4']);
  play('p2', 'g3');
  assert.equal(g.current.id, 'p0', 'p1 is passed over');
  assertRefused(g, () => act('p0', { type: 'catch', target: 'p1' }), /out of this round/);
  setHand(g, 'p0', ['g7', 'g2']);
  assertRefused(g, () => play('p0', 'g7', { target: 'p1' }), /out of this round/);
  play('p0', 'g7', { target: 'p2' }); // 7-0 is on in this preset
  assert.equal(g.current.id, 'p2');

  // The round's winner scores the knocked-out hand as it was (the 6 it took included).
  setHand(g, 'p2', ['g9']);
  play('p2', 'g9');
  const r = g.history[0];
  assert.equal(r.winner, 'p2');
  assert.deepEqual(r.out, ['p1']);
  assert.ok(r.hands.p1 >= owed);
  assert.equal(r.points, r.hands.p1 + r.hands.p0);

  // Back for the next deal.
  g.startNextRound();
  assert.equal(g.player('p1').out, undefined);
  assert.ok(g.player('p1').hand.length >= 7, 'dealt in (a Draw Two turned up may add 2)');
  assert.ok(g.inRound().includes(g.player('p1')));
  assert.deepEqual(g.knocked, []);
  assertConserved(g);
});

test('Mercy: the last one standing wins the round', () => {
  const { g, act, play } = table(2, { rules: { ...STACKING, mercy: true, match: 'single' } });
  setHand(g, 'p0', ['W10', 'g1', 'g2']);
  bulk(g, 'p1', 10); // 17
  play('p0', 'W10', { color: 'green' });
  act('p1', { type: 'draw' });
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  assert.equal(g.player('p0').hand.length, 2, 'won with cards in hand');
  assert.ok(g.log.some(e => e.text.startsWith('P0 is the last one standing and wins round 1')));
  assert.deepEqual(stepTypes(g).slice(-2), ['mercy', 'roundEnd']);
  assertConserved(g);
});

test('Mercy: a player knocked out on their own turn (a 0 passed them 25) — the turn moves on', () => {
  const { g, play } = table(3, { rules: { ...CHAOS, sevenZero: true, mercy: true } });
  setHand(g, 'p0', ['g0']);
  bulk(g, 'p0', 25); // 26: the 0 leaves 25, passed on to p1
  play('p0', 'g0');
  assert.equal(g.player('p1').out, true);
  assert.equal(g.current.id, 'p2', 'p1 was up next: the turn went straight on');
  assert.equal(g.phase, 'play');
  assertConserved(g);
});

test('Mercy is off unless asked for: any number of cards is fine', () => {
  const { g, act, play } = table(3, { rules: STACKING });
  setHand(g, 'p0', ['W10', 'g1']);
  bulk(g, 'p1', 20);
  play('p0', 'W10', { color: 'green' });
  act('p1', { type: 'draw' });
  assert.equal(g.player('p1').hand.length, 37);
  assert.equal(g.player('p1').out, undefined);
});

test('a player who leaves after being knocked out; the last one standing still takes the round', () => {
  const { g, act, play } = table(3, { rules: { ...STACKING, mercy: true } });
  setHand(g, 'p0', ['W10', 'g1']);
  bulk(g, 'p1', 17); // 24
  play('p0', 'W10', { color: 'green' });
  act('p1', { type: 'draw' });
  assert.equal(g.player('p1').out, true);
  g.forfeit('p1');
  assert.equal(g.phase, 'play', 'p0 and p2 are still in it');
  g.forfeit('p2');
  assert.equal(g.phase, 'over', 'everyone else has left');
  assert.equal(g.winner, 'p0');
  assertConserved(g);
});

test('snapshot / restore mid-Chaos: a stack chain, knocked-out players and the Mercy order survive', () => {
  const { g, act, play, now } = table(4, { rules: { ...STACKING, mercy: true } });
  setHand(g, 'p0', ['W10', 'g1', 'g2']);
  bulk(g, 'p1', 17); // 24
  play('p0', 'W10', { color: 'green' });
  act('p1', { type: 'draw' });
  setHand(g, 'p2', ['g+2', 'g3']);
  setHand(g, 'p3', ['W6', 'g4']);
  play('p2', 'g+2');
  play('p3', 'W6', { color: 'red' });
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const g2 = CardsGame.restore({ now }, snap);
  assert.equal(g2.rules.mode, 'chaos');
  assert.equal(g2.deckSize, 135);
  assert.deepEqual(g2.knocked, ['p1']);
  assert.equal(g2.player('p1').out, true);
  assert.deepEqual(g2.view('p0').pendingDraw, g.view('p0').pendingDraw);
  assert.equal(g2.view('p0').pendingDraw!.chain, 2);
  assert.equal(g2.current.id, 'p0', 'p1 is still passed over');
  assertConserved(g2);
  // A snapshot from before stacks were counted (no chain) reads as a single card.
  delete snap.pending.chain;
  assert.equal(CardsGame.restore({ now }, snap).view('p0').pendingDraw!.chain, 1);
});

// ---- the bot ---------------------------------------------------------------------

test('bot: a Purge that clears plenty beats a plain card; one that clears the hand wins', () => {
  const a = table(3, { rules: CHAOS, bots: BOTS });
  setHand(a.g, 'p0', ['gP', 'g1', 'g2', 'g3', 'r5']);
  assert.equal(playOf(cardsBotAction(a.g, 'p0')).card, a.card('p0', 'gP'));

  const b = table(3, { rules: CHAOS, bots: BOTS });
  setHand(b.g, 'p0', ['gP', 'g1']);
  assert.equal(playOf(cardsBotAction(b.g, 'p0')).card, b.card('p0', 'gP'));

  // Down to one after the Purge: called with the play.
  const c = table(3, { rules: CHAOS, bots: BOTS });
  setHand(c.g, 'p0', ['gP', 'g1', 'r2']);
  const p = playOf(cardsBotAction(c.g, 'p0'));
  assert.equal(p.card, c.card('p0', 'gP'));
  assert.equal(p.callLastCard, true);
});

test('bot: answers a stack with the smallest Draw card that will do, keeping the big ones', () => {
  const { g, card, play } = table(3, { rules: STACKING, bots: BOTS });
  setHand(g, 'p0', ['g+2', 'g1', 'g2']);
  setHand(g, 'p1', ['W10', 'W6', 'r+2', 'r5']);
  play('p0', 'g+2');
  assert.equal(playOf(cardsBotAction(g, 'p1')).card, card('p1', 'r+2'));
});

test('bot: a big Draw card is saved, unless it knocks someone out under the Mercy rule', () => {
  const calm = table(3, { rules: { ...CHAOS, mercy: true }, bots: BOTS });
  setHand(calm.g, 'p0', ['W10', 'g3', 'g4', 'g5']);
  assert.notEqual(playOf(cardsBotAction(calm.g, 'p0')).card, calm.card('p0', 'W10'));

  const kill = table(3, { rules: { ...CHAOS, mercy: true }, bots: BOTS });
  setHand(kill.g, 'p0', ['W10', 'g3', 'g4', 'g5']);
  bulk(kill.g, 'p1', 9); // 16: +10 is over the limit
  assert.ok(kill.g.player('p1').hand.length + 10 >= CARDS_MERCY_LIMIT);
  assert.equal(playOf(cardsBotAction(kill.g, 'p0')).card, kill.card('p0', 'W10'));

  // The same position without Mercy: no reason to spend it.
  const noMercy = table(3, { rules: CHAOS, bots: BOTS });
  setHand(noMercy.g, 'p0', ['W10', 'g3', 'g4', 'g5']);
  bulk(noMercy.g, 'p1', 9);
  assert.notEqual(playOf(cardsBotAction(noMercy.g, 'p0')).card, noMercy.card('p0', 'W10'));

  // Someone about to go out: Gas Spike them.
  const tense = table(3, { rules: CHAOS, bots: BOTS });
  setHand(tense.g, 'p0', ['W6', 'g3', 'g4']);
  setHand(tense.g, 'p1', ['r1']);
  const a = playOf(cardsBotAction(tense.g, 'p0'));
  assert.equal(a.card, tense.card('p0', 'W6'));
  assert.equal(a.color, 'green');
});

test('bot: a Blitz when someone is close; Chog Roulette on a player about to win', () => {
  const b = table(3, { rules: CHAOS, bots: BOTS });
  setHand(b.g, 'p0', ['gB', 'g3', 'r4']);
  setHand(b.g, 'p1', ['r1', 'r2']);
  assert.equal(playOf(cardsBotAction(b.g, 'p0')).card, b.card('p0', 'gB'));

  const r = table(3, { rules: CHAOS, bots: BOTS });
  setHand(r.g, 'p0', ['WR', 'b3', 'b4', 'r1']);
  setHand(r.g, 'p1', ['y1']);
  const a = playOf(cardsBotAction(r.g, 'p0'));
  assert.equal(a.card, r.card('p0', 'WR'));
  assert.equal(a.color, 'blue', 'the colour it holds most of (the fewest left for the victim to find)');
});

test('bot: never picks a knocked-out player to swap hands with', () => {
  const { g, act, play } = table(3, { rules: { ...STACKING, sevenZero: true, mercy: true }, bots: BOTS });
  setHand(g, 'p0', ['W10', 'g1']);
  bulk(g, 'p1', 17); // 24
  play('p0', 'W10', { color: 'green' });
  act('p1', { type: 'draw' });
  assert.equal(g.player('p1').out, true);
  setHand(g, 'p2', ['g7', 'g3', 'g4']);
  const a = playOf(cardsBotAction(g, 'p2'));
  if (a.target !== undefined) assert.equal(a.target, 'p0');
  assert.doesNotThrow(() => g.apply('p2', a));
});

test('a full Chog Chaos game of bots is played out, every card always accounted for', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let clock = 1_000_000;
    const g = new CardsGame({
      players: Array.from({ length: 2 + (seed % 5) }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, level: (['easy', 'normal', 'hard'] as const)[i % 3] })),
      rules: { mode: 'chaos', ...CARDS_MODES[1].preset, match: 'single' },
      now: () => clock,
      rng: (k => { let s = seed * 9301; return (n: number) => { s = (s * 49297 + 233280) % 233280; return Math.floor((s / 233280) * n); }; })(0),
    });
    for (let i = 0; g.phase !== 'over'; i++) {
      assert.ok(i < 5_000, `seed ${seed}: the game did not end`);
      const mover = g.active().map(p => ({ id: p.id, a: cardsBotAction(g, p.id) })).find(x => x.a);
      assert.ok(mover, `seed ${seed}: nobody can move`);
      clock += 2_000;
      g.apply(mover.id, mover.a!, { auto: true });
      assertConserved(g, `seed ${seed}`);
    }
  }
});
