// The Poker Daily's maths (shared/poker/hands.ts, shared/poker/equity.ts):
// the hand evaluator against known hands and against the slow reference, the
// Chen formula, draws, and equities against known results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_COMBOS, CAT, categoryOf, chen, comboClass, drawScore, evaluate, evaluate5, evaluateSlow, handName, parseCards, topRange,
  type Combo,
} from '../../shared/poker/hands.ts';
import { equityByCombo, equityVsRange, makeRng, meanEquity } from '../../shared/poker/equity.ts';

const s = (cards: string) => evaluate(parseCards(cards));
const combo = (cards: string) => parseCards(cards) as Combo;

test('every category, in order', () => {
  const ordered = [
    'As Ks Qs Js Ts', '9h 8h 7h 6h 5h', 'Ac Ad Ah As Kd', 'Kc Kd Kh 2s 2d', 'Ah Jh 9h 6h 3h',
    '9c 8d 7h 6s 5c', 'Qc Qd Qh 9s 2d', 'Jc Jd 8h 8s 3d', 'Tc Td 9h 5s 2d', 'Ac Jd 9h 6s 3d',
  ].map(s);
  for (let i = 0; i < ordered.length - 1; i++) assert.ok(ordered[i] > ordered[i + 1], `hand ${i} beats hand ${i + 1}`);
  assert.deepEqual(ordered.map(categoryOf), [8, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(handName(ordered[0]), 'Royal flush');
  assert.equal(handName(ordered[1]), 'Straight flush');
  assert.equal(handName(ordered[3]), 'Full house');
  assert.equal(handName(ordered[9]), 'High card');
});

test('the wheel is a five-high straight, and kickers break ties', () => {
  assert.equal(categoryOf(s('Ah 2c 3d 4s 5h')), CAT.STRAIGHT);
  assert.ok(s('2c 3d 4s 5h 6d') > s('Ah 2c 3d 4s 5h'));
  assert.equal(categoryOf(s('Ah 2h 3h 4h 5h')), CAT.STRAIGHT_FLUSH);
  assert.ok(s('Ac Ad Kh 9s 2d') > s('Ah As Qh 9c 2c'));
  assert.ok(s('Kc Kd 8h 8s Ad') > s('Kh Ks 8c 8d Qd'), 'two pair: the kicker');
  assert.ok(s('Qc Qd Qh As 3d') > s('Qc Qd Qh Ks Jd'), 'trips: the kicker');
});

test('seven cards: the best five', () => {
  assert.equal(categoryOf(s('Ah Kh Qh 7c 7d 7h 2h')), CAT.FLUSH, 'a flush beats the trips');
  assert.equal(categoryOf(s('7c 7d 7h Kc Kd 2s 3s')), CAT.FULL_HOUSE);
  assert.equal(categoryOf(s('7c 7d 7h Kc Kd Ks 3s')), CAT.FULL_HOUSE, 'two sets make a full house');
  assert.equal(s('Kc Kd Ks 7c 7d 7h 3s'), s('Kc Kd Ks 7c 7d 2s 3s'), 'kings full of sevens either way');
  assert.equal(categoryOf(s('9c 8c 7c 6c 5c 4c 3c')), CAT.STRAIGHT_FLUSH);
  assert.equal(s('9c 8c 7c 6c 5c 4c 3c'), s('9c 8c 7c 6c 5c'), 'the nine-high straight flush');
  assert.equal(categoryOf(s('Ac Ad As Ah Kc Kd Ks')), CAT.QUADS);
  assert.equal(s('2h 3d Ac Kd Qh Js Tc'), s('4s 5c Ac Kd Qh Js Tc'), 'both play the board: a split');
  assert.equal(categoryOf(s('Ah Ad Kh Kd Qh Qd 2c')), CAT.TWO_PAIR);
  assert.equal(s('Ah Ad Kh Kd Qh Qd 2c'), s('Ah Ad Kh Kd Qs 3c 2c'), 'three pairs: the third pair is just a kicker');
});

test('the fast evaluator agrees with the slow one on 30,000 random hands of 5, 6 and 7', () => {
  const rng = makeRng('evaluator-agrees');
  for (let i = 0; i < 30_000; i++) {
    const deck = Array.from({ length: 52 }, (_, k) => k);
    for (let k = 51; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]]; }
    const hand = deck.slice(0, 5 + (i % 3));
    assert.equal(evaluate(hand), evaluateSlow(hand), `hand ${hand.join(',')}`);
  }
  // And evaluate5 is the reference for five.
  assert.equal(evaluate5(parseCards('As Ks Qs Js Ts')), s('As Ks Qs Js Ts'));
});

test('the Chen formula: its textbook scores, and the ranges built on it', () => {
  assert.equal(chen(...combo('As Ah')), 20);
  assert.equal(chen(...combo('Ks Kh')), 16);
  assert.equal(chen(...combo('As Ks')), 12);
  assert.equal(chen(...combo('Ts 9s')), 8, 'T9s: 5 + 2 suited + 1 connected and low');
  assert.equal(chen(...combo('7c 2d')), -1, '72o: 3.5 − 5, rounded up');
  assert.equal(chen(...combo('2c 2d')), 5, 'small pairs score at least 5');
  assert.equal(ALL_COMBOS.length, 1326);
  assert.equal(new Set(ALL_COMBOS.map(c => `${c[0]}-${c[1]}`)).size, 1326);
  assert.equal(comboClass(ALL_COMBOS[0]), 'AA');
  assert.equal(chen(...ALL_COMBOS.at(-1)!), -1, 'the worst hands score −1');
  const top = new Set(topRange(0.1).map(comboClass));
  for (const h of ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs']) assert.ok(top.has(h), `${h} is in the top 10%`);
  assert.ok(!top.has('72o') && !top.has('T2o'));
  assert.equal(topRange(0.25).length, Math.round(1326 * 0.25));
});

test('draws', () => {
  assert.equal(drawScore(combo('Ah 5h'), parseCards('Kh 9h 2c')), 2, 'a flush draw');
  assert.equal(drawScore(combo('9c 8d'), parseCards('7h 6s 2c')), 2, 'open-ended');
  assert.equal(drawScore(combo('9c 8d'), parseCards('6h 5s Kc')), 1, 'a gutshot');
  assert.equal(drawScore(combo('Ac Kd'), parseCards('7h 6s 2c')), 0);
  assert.equal(drawScore(combo('Ac Kd'), parseCards('9h 8s 7c 6d')), 0, 'the straight draw is all on the board');
  assert.equal(drawScore(combo('Ah 5h'), parseCards('Kh 9h 2c 3d 4s')), 0, 'nothing to draw to on the river');
});

test('equity: known match-ups', () => {
  const rng = makeRng('equity-known');
  const eq = (h: string, v: string, board = '', samples = 60_000) => equityVsRange(combo(h), board ? parseCards(board) : [], [combo(v)], rng, { samples });
  // Pre-flop all-in figures, as every equity calculator gives them (±1%).
  const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) < tol, `${what}: ${got.toFixed(4)} ≈ ${want}`);
  near(eq('As Ah', 'Ks Kh'), 0.8236, 0.01, 'AA v KK');
  near(eq('As Ks', 'Qd Qh'), 0.4614, 0.01, 'AKs v QQ');
  near(eq('Ah Kd', '2c 2s'), 0.4697, 0.01, 'AKo v 22');
  near(eq('Jh Th', 'As Ad'), 0.2288, 0.01, 'JTs v AA');
  // Exact on the turn and river: these are counted, not sampled.
  assert.equal(eq('Ah Kh', 'Qc Qd', 'Qh 7h 2c 3s'), 7 / 44, 'nine hearts left, but 2h and 3h fill him up: 7 outs of 44');
  assert.equal(eq('As Kd', 'Qc Qd', '2h 7s 9c Jd 3h'), 0, 'the river is out: no outs left');
  assert.equal(eq('As Kd', 'Ac Kc', '2h 7s 9c Jd 3h'), 0.5, 'a split');
  // On the flop, sampled: he needs a queen (87 of 990 turn-and-river pairs), less the 4 that also bring an ace.
  near(eq('Ac Kd', 'Qc Qd', 'Ah 7s 2c'), 907 / 990, 0.006, 'AK v QQ on A72');
});

test('equity against a range: the mean over the hands that can be held, blocked ones left out', () => {
  const rng = makeRng('equity-range');
  const range = [combo('Ks Kh'), combo('As Kd'), combo('Qc Qd')];
  const by = equityByCombo(combo('As Ah'), parseCards('2c 7d 9h 3s'), range, rng);
  assert.ok(Number.isNaN(by[1]), 'AsKd shares the ace of spades: it cannot be held');
  assert.ok(by[0] > 0.9 && by[2] > 0.9);
  assert.equal(meanEquity(by), (by[0] + by[2]) / 2);
  // The same seed gives the same sampled numbers.
  const a = equityVsRange(combo('Ah Kd'), [], topRange(0.2), makeRng('same'), { samples: 5000 });
  const b = equityVsRange(combo('Ah Kd'), [], topRange(0.2), makeRng('same'), { samples: 5000 });
  assert.equal(a, b);
  assert.ok(a > 0.5 && a < 0.7, `AKo v the top 20%: ${a}`);
});
