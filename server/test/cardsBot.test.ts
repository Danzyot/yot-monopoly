// The card bot: sensible plays, Wilds kept for when they are needed, colour
// picks, "Last card!" (a little late now and then on easy), catches,
// challenges, stacking, jump-ins, human-like think times, autopilot, and no
// peeking at anything its seat could not see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS_BOT_BASE_MS, cardsAutopilotAction, cardsBotAction, cardsBotThinkMs, decide } from '../src/cards/bot.ts';
import { LAST_CARD_GRACE_MS } from '../src/cards/game.ts';
import type { CardsAction } from '../../shared/cards/types.ts';
import { matcher, putOnTop, setHand, table } from './cardsHelpers.ts';

const BOTS = { 0: 'normal', 1: 'normal', 2: 'normal' } as const;

function playOf(a: CardsAction | null) {
  assert.ok(a && a.type === 'play', `expected a play, got ${JSON.stringify(a)}`);
  return a;
}

test('dumps a Draw Two on a player about to go out; otherwise keeps to its colour', () => {
  const calm = table(3, { bots: BOTS });
  setHand(calm.g, 'p0', ['g+2', 'b9', 'b8', 'b6', 'b5', 'b4']);
  assert.equal(playOf(cardsBotAction(calm.g, 'p0')).card, calm.card('p0', 'b9'));

  const tense = table(3, { bots: BOTS });
  setHand(tense.g, 'p0', ['g+2', 'b9', 'b8', 'b6', 'b5', 'b4']);
  setHand(tense.g, 'p1', ['r1', 'r2']);
  assert.equal(playOf(cardsBotAction(tense.g, 'p0')).card, tense.card('p0', 'g+2'));
});

test('keeps a Wild while a coloured card will do', () => {
  const { g, card } = table(3, { bots: BOTS });
  setHand(g, 'p0', ['W', 'g3', 'r5']);
  assert.equal(playOf(cardsBotAction(g, 'p0')).card, card('p0', 'g3'));
});

test('a Wild when it is the only play, naming the colour it holds most of', () => {
  const { g, card } = table(3, { bots: BOTS });
  setHand(g, 'p0', ['W', 'b1', 'b2', 'r3']);
  const a = playOf(cardsBotAction(g, 'p0'));
  assert.equal(a.card, card('p0', 'W'));
  assert.equal(a.color, 'blue');
});

test('never bluffs a Draw Four (normal), even with a player about to win', () => {
  const { g, card } = table(3, { bots: BOTS });
  setHand(g, 'p0', ['W4', 'g3']);
  setHand(g, 'p1', ['r1']);
  assert.equal(playOf(cardsBotAction(g, 'p0')).card, card('p0', 'g3'));
});

test('calls "Last card!" with the play — easy bots sometimes a beat late', () => {
  const { g } = table(3, { bots: { 0: 'easy', 1: 'normal', 2: 'hard' } });
  setHand(g, 'p0', ['g3', 'g4']);
  const v = g.view('p0');
  for (const level of ['normal', 'hard'] as const) {
    for (let t = 0; t < 50; t++) assert.equal(playOf(decide({ ...v, turn: t }, level)).callLastCard, true, `${level} ${t}`);
  }
  let late = 0;
  for (let t = 0; t < 200; t++) if (!playOf(decide({ ...v, turn: t }, 'easy')).callLastCard) late++;
  assert.ok(late > 30 && late < 110, `easy forgot ${late}/200 times`);
});

test('an easy bot that played without calling calls on its next decision, after a moment', () => {
  const { g } = table(3, { bots: { 0: 'easy', 1: 'normal', 2: 'normal' } });
  setHand(g, 'p0', ['g3', 'g4']);
  // Find a position where it forgets.
  let a = playOf(cardsBotAction(g, 'p0'));
  for (let t = 0; a.callLastCard; t++) {
    g.turn = t;
    a = playOf(cardsBotAction(g, 'p0'));
  }
  g.apply('p0', a);
  assert.equal(g.view().oneCard[0].calledAt, null);
  const call = cardsBotAction(g, 'p0');
  assert.deepEqual(call, { type: 'callLastCard' });
  const ms = cardsBotThinkMs(g, 'p0', call!);
  assert.ok(ms >= 1500 && ms <= 3500, `late call after ${ms} ms`);
});

test('catches a player who forgot, but not before the grace is up', () => {
  const { g, play, tick, now } = table(3, { bots: BOTS });
  setHand(g, 'p0', ['g3', 'g4']);
  play('p0', 'g3');
  for (const id of ['p1', 'p2']) {
    const a = cardsBotAction(g, id);
    assert.deepEqual(a, { type: 'catch', target: 'p0' }, id);
    assert.ok(cardsBotThinkMs(g, id, a!) >= LAST_CARD_GRACE_MS, 'waits out the grace');
  }
  const wait = cardsBotThinkMs(g, 'p2', { type: 'catch', target: 'p0' });
  tick(wait);
  assert.ok(now() >= g.view().oneCard[0].catchFrom);
  g.apply('p2', cardsBotAction(g, 'p2')!);
  assert.equal(g.player('p0').hand.length, 3);
});

test('challenges a Draw Four from a big hand, takes it from a small one', () => {
  const big = table(3, { bots: BOTS });
  setHand(big.g, 'p0', ['W4', 'r1', 'r2', 'r3', 'r4', 'r5', 'b1', 'b2']);
  big.play('p0', 'W4', { color: 'red' });
  assert.deepEqual(cardsBotAction(big.g, 'p1'), { type: 'challenge' });

  const small = table(3, { bots: BOTS });
  setHand(small.g, 'p0', ['W4', 'r1', 'r2', 'r3']);
  small.play('p0', 'W4', { color: 'red' });
  assert.deepEqual(cardsBotAction(small.g, 'p1'), { type: 'draw' });
});

test('stacks a Draw card rather than drawing (a Draw Two before a Draw Four)', () => {
  const { g, card, play } = table(3, { bots: BOTS, rules: { stacking: true, stackMixed: true } });
  setHand(g, 'p0', ['g+2', 'g1', 'g2']);
  setHand(g, 'p1', ['W4', 'r+2', 'b3']);
  play('p0', 'g+2');
  assert.equal(playOf(cardsBotAction(g, 'p1')).card, card('p1', 'r+2'));
});

test('jumps in with an identical card when the table allows it', () => {
  const { g, card, play } = table(3, { bots: { 0: 'normal', 1: 'normal', 2: 'hard' }, rules: { jumpIn: true } });
  setHand(g, 'p0', ['g5', 'g1', 'g2']);
  setHand(g, 'p2', ['g5', 'r1']);
  play('p0', 'g5');
  const a = playOf(cardsBotAction(g, 'p2'));
  assert.equal(a.card, card('p2', 'g5'));
  assert.ok(cardsBotThinkMs(g, 'p2', a) < CARDS_BOT_BASE_MS, 'a reflex, quicker than a turn');
  assert.equal(cardsBotAction(g, 'p0'), null, 'nothing to do out of turn');
});

test('names colours and picks swap partners when asked', () => {
  const { g, play } = table(3, { bots: BOTS, rules: { sevenZero: true }, flip: ['W'] });
  setHand(g, 'p0', ['y1', 'y2', 'g7', 'b3']);
  assert.deepEqual(cardsBotAction(g, 'p0'), { type: 'chooseColor', color: 'yellow' });
  g.apply('p0', { type: 'chooseColor', color: 'green' });
  setHand(g, 'p2', ['r1', 'r2']);
  play('p0', 'g7');
  assert.deepEqual(cardsBotAction(g, 'p0'), { type: 'swap', target: 'p2' });
});

test('keeps a drawn Wild for later when nobody is close; forced play plays it', () => {
  const { g } = table(3, { bots: BOTS });
  setHand(g, 'p0', ['r1', 'r2', 'b3', 'b4']);
  putOnTop(g, 'W');
  g.apply('p0', { type: 'draw' });
  assert.deepEqual(cardsBotAction(g, 'p0'), { type: 'pass' });

  const f = table(3, { bots: BOTS, rules: { forcedPlay: true } });
  setHand(f.g, 'p0', ['r1', 'r2', 'b3', 'b4']);
  putOnTop(f.g, 'W');
  f.g.apply('p0', { type: 'draw' });
  assert.equal(playOf(cardsBotAction(f.g, 'p0')).card, f.card('p0', 'W'));
});

test('no peeking: hidden cards (other hands, the pile) never change its move', () => {
  const pick = (others: string[]) => {
    const { g } = table(3, { bots: BOTS });
    setHand(g, 'p0', ['g+2', 'g3', 'b9', 'W']);
    setHand(g, 'p1', others);
    return JSON.stringify(cardsBotAction(g, 'p0'));
  };
  assert.equal(pick(['r1', 'r2', 'r3']), pick(['W4', 'W4', 'g+2']));
});

test('nothing to do: game over, paused, or not its turn', () => {
  const { g, play } = table(3, { bots: BOTS, rules: { match: 'single' } });
  assert.equal(cardsBotAction(g, 'p1'), null);
  g.pause('Host');
  assert.equal(cardsBotAction(g, 'p0'), null);
  g.resume('Host');
  setHand(g, 'p0', ['g1']);
  play('p0', 'g1');
  assert.equal(cardsBotAction(g, 'p0'), null);
  assert.equal(cardsBotAction(g, 'nobody'), null);
});

test('think times are human-like and seeded', () => {
  const { g, card } = table(3, { bots: { 0: 'normal', 1: 'easy', 2: 'hard' } });
  const a: CardsAction = { type: 'play', card: card('p0', g.player('p0').hand.find(matcher('y1')) ? 'y1' : 'y2') };
  const ms = cardsBotThinkMs(g, 'p0', a);
  assert.ok(ms >= CARDS_BOT_BASE_MS && ms <= CARDS_BOT_BASE_MS + 1100, `${ms}`);
  assert.equal(cardsBotThinkMs(g, 'p0', a), ms, 'same state, same pause');
  assert.ok(cardsBotThinkMs(g, 'p0', { type: 'challenge' }) >= 1200);
});

test('autopilot keeps an absent player moving but takes no risks for them', () => {
  const { g } = table(3);
  const play: CardsAction = { type: 'play', card: g.player('p0').hand[0].id };
  assert.equal(cardsAutopilotAction(g, 'p1', { type: 'catch', target: 'p0' }), null, 'no catches');
  assert.deepEqual(cardsAutopilotAction(g, 'p0', { type: 'challenge' }), { type: 'draw' }, 'no challenges');
  assert.equal(cardsAutopilotAction(g, 'p1', play), null, 'no jump-ins');
  assert.deepEqual(cardsAutopilotAction(g, 'p0', play), play, 'its own turn: plays');
  assert.deepEqual(cardsAutopilotAction(g, 'p0', { type: 'callLastCard' }), { type: 'callLastCard' }, 'always calls');
});
