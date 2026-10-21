// Achievements from synthetic results: every badge, its progress, when it was
// earned, and the facts recorded at game end that some of them need (whole
// colour sets in Monopoly, the best round won in Cards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAchievements, gamesOf, type AchievementInput } from '../src/achievements.ts';
import { bestRounds, type CardsRecord } from '../src/cards/stats.ts';
import type { GameRecord } from '../src/stats.ts';
import { ACH, ACHIEVEMENTS, sortAchievements, type Achievement } from '../../shared/achievements.ts';
import type { TournamentResult } from '../../shared/tournaments.ts';
import type { CardsRoundResult } from '../../shared/cards/types.ts';
import { scripted } from './helpers.ts';

const DAY = 86_400_000;
type MonoPlace = GameRecord['places'][number];
type CardsPlace = CardsRecord['places'][number];

const human = (id: string, extra: Partial<MonoPlace> = {}): MonoPlace => ({ id, name: id.toUpperCase(), isBot: false, netWorth: 0, ...extra });
const bot = (id: string): MonoPlace => ({ id, name: id, isBot: true, netWorth: 0 });
const mono = (endedAt: number, places: MonoPlace[], mapId = 'classic'): GameRecord =>
  ({ code: `M${endedAt}`, mapId, themeId: 'chog', startedAt: endedAt - 1000, endedAt, turns: 40, places });

const chuman = (id: string, extra: Partial<CardsPlace> = {}): CardsPlace => ({ id, name: id.toUpperCase(), isBot: false, score: 0, ...extra });
const cbot = (id: string): CardsPlace => ({ id, name: id, isBot: true, score: 0 });
const cards = (endedAt: number, places: CardsPlace[], match: CardsRecord['match'] = 'single'): CardsRecord =>
  ({ game: 'cards', code: `C${endedAt}`, startedAt: endedAt - 1000, endedAt, rounds: 1, match, targetScore: 200, places });

const tourney = (endedAt: number, place: number, finalTable = false): TournamentResult =>
  ({ id: `t${endedAt}`, game: 'cards', name: 'Cup', place, of: 12, endedAt, ...(finalTable ? { finalTable: true } : {}) });

function badges(input: Partial<AchievementInput>, id = 'ann'): Record<string, Achievement> {
  const list = computeAchievements(id, { monopoly: [], cards: [], tournaments: [], walletLinkedAt: null, ...input });
  return Object.fromEntries(list.map(a => [a.id, a]));
}

/** A Monopoly win (ann first) or loss against one bot. */
const monoWin = (t: number, extra: Partial<MonoPlace> = {}, mapId?: string) => mono(t, [human('ann', extra), bot('b1')], mapId);
const monoLoss = (t: number, extra: Partial<MonoPlace> = {}) => mono(t, [bot('b1'), human('ann', extra)]);
const cardsWin = (t: number, extra: Partial<CardsPlace> = {}, match?: CardsRecord['match']) => cards(t, [chuman('ann', extra), cbot('b1')], match);
const cardsLoss = (t: number, extra: Partial<CardsPlace> = {}) => cards(t, [cbot('b1'), chuman('ann', extra)]);

test('the catalogue: 20 to 30 badges, unique ids, every one with a rule', () => {
  assert.ok(ACHIEVEMENTS.length >= 20 && ACHIEVEMENTS.length <= 30, `${ACHIEVEMENTS.length} badges`);
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length);
  // A player with everything: every badge must be earnable (no badge without a rule).
  const t0 = 1_000_000;
  const all: GameRecord[] = [];
  const allCards: CardsRecord[] = [];
  for (let i = 0; i < 60; i++) {
    all.push(mono(t0 + i * DAY, [human('ann', { sets: 3, chogToken: 7 }), human('b'), human('c'), human('d')], ['classic', 'speed', 'metropolis'][i % 3]));
    allCards.push(cards(t0 + i * DAY + 1, [chuman('ann', { bestRound: 150, roundCards: 20 }), chuman('b'), chuman('c'), cbot('d')], 'points'));
  }
  const b = badges({ monopoly: all, cards: allCards, tournaments: [tourney(t0, 1, true)], walletLinkedAt: t0 });
  for (const a of ACHIEVEMENTS) assert.ok(b[a.id].earned, `${a.id} is earnable`);
});

test('a newcomer has every badge locked, with progress at zero', () => {
  const b = badges({});
  for (const a of Object.values(b)) {
    assert.equal(a.earned, false, a.id);
    assert.equal(a.earnedAt, null);
    if (a.progress) assert.equal(a.progress.have, 0, a.id);
  }
  assert.deepEqual(b['games-10'].progress, { have: 0, need: 10 });
  assert.equal(b['mono-first-win'].progress, null, 'a one-off badge has no progress bar');
});

test('first game and first wins, in each game, earned when the game ended', () => {
  const b = badges({ monopoly: [monoLoss(100), monoWin(200)], cards: [cardsLoss(150), cardsWin(300)] });
  assert.equal(b['first-game'].earnedAt, 100);
  assert.equal(b['mono-first-win'].earnedAt, 200);
  assert.equal(b['cards-first-win'].earnedAt, 300);
  // A bot's place never counts for a human with the same id.
  const imposter = badges({ monopoly: [mono(100, [{ ...bot('ann') }, human('zed')])] });
  assert.equal(imposter['first-game'].earned, false);
});

test('games played: 10, 50 and 100 across both games, with progress', () => {
  const ms = Array.from({ length: 30 }, (_, i) => monoLoss(i * 10));
  const cs = Array.from({ length: 25 }, (_, i) => cardsLoss(i * 10 + 5));
  const b = badges({ monopoly: ms, cards: cs });
  assert.equal(b['games-10'].earned, true);
  assert.equal(b['games-10'].earnedAt, 45, 'the tenth game, both kinds in time order');
  assert.equal(b['games-50'].earned, true);
  assert.equal(b['games-100'].earned, false);
  assert.deepEqual(b['games-100'].progress, { have: 55, need: 100 });
  assert.deepEqual(b['games-10'].progress, { have: 10, need: 10 }, 'earned: full bar');
});

test('win streaks: three and five in a row, across games; a loss breaks the run', () => {
  const two = badges({ monopoly: [monoWin(1), monoWin(2), monoLoss(3), monoWin(4)] });
  assert.equal(two['streak-3'].earned, false);
  assert.deepEqual(two['streak-3'].progress, { have: 2, need: 3 }, 'the best run so far');
  const three = badges({ monopoly: [monoWin(1), monoLoss(2), monoWin(3)], cards: [cardsWin(4), cardsWin(5)] });
  assert.equal(three['streak-3'].earnedAt, 5, 'Monopoly and Cards wins chain');
  assert.equal(three['streak-5'].earned, false);
  const five = badges({ cards: [1, 2, 3, 4, 5, 6].map(t => cardsWin(t)) });
  assert.equal(five['streak-5'].earnedAt, 5);
});

test('wins: 25 in all, 10 per game', () => {
  const ms = Array.from({ length: 12 }, (_, i) => monoWin(i));
  const cs = Array.from({ length: 13 }, (_, i) => cardsWin(100 + i));
  const b = badges({ monopoly: ms, cards: cs });
  assert.equal(b['mono-wins-10'].earnedAt, 9);
  assert.equal(b['cards-wins-10'].earnedAt, 109);
  assert.equal(b['wins-25'].earnedAt, 112);
  const few = badges({ monopoly: ms.slice(0, 4) });
  assert.deepEqual(few['mono-wins-10'].progress, { have: 4, need: 10 });
});

test('both games: earned with the first game of the second kind', () => {
  assert.deepEqual(badges({ monopoly: [monoLoss(5)] })['both-games'].progress, { have: 1, need: 2 });
  const b = badges({ monopoly: [monoLoss(5), monoLoss(6)], cards: [cardsLoss(8)] });
  assert.equal(b['both-games'].earnedAt, 8);
});

test('beat humans: a win with two or more other people at the table', () => {
  const vsBots = badges({ monopoly: [mono(1, [human('ann'), human('b'), bot('x'), bot('y')])] });
  assert.equal(vsBots['beat-humans'].earned, false, 'one other person is not enough');
  const lost = badges({ monopoly: [mono(1, [human('b'), human('ann'), human('c')])] });
  assert.equal(lost['beat-humans'].earned, false, 'a loss is not a win');
  const won = badges({ cards: [cards(2, [chuman('ann'), chuman('b'), chuman('c')])] });
  assert.equal(won['beat-humans'].earnedAt, 2);
});

test(`old guard: still playing ${ACH.oldGuardDays} days after the first game`, () => {
  const early = badges({ monopoly: [monoLoss(0), monoLoss(10 * DAY)] });
  assert.deepEqual(early['old-guard'].progress, { have: 10, need: ACH.oldGuardDays });
  const b = badges({ monopoly: [monoLoss(0), monoLoss(10 * DAY), monoLoss(31 * DAY), monoLoss(40 * DAY)] });
  assert.equal(b['old-guard'].earnedAt, 31 * DAY);
});

test('Monopoly: a win on every board, whichever order', () => {
  const boards = ['classic', 'speed', 'metropolis'];
  const part = badges({ monopoly: [monoWin(1, {}, 'classic'), monoWin(2, {}, 'classic'), monoLoss(3), monoWin(4, {}, 'speed')], boards });
  assert.deepEqual(part['mono-every-board'].progress, { have: 2, need: 3 });
  assert.equal(part['mono-every-board'].earned, false);
  const all = badges({ monopoly: [monoWin(1, {}, 'speed'), monoWin(2, {}, 'metropolis'), monoWin(3, {}, 'retired-board'), monoWin(4, {}, 'classic')], boards });
  assert.equal(all['mono-every-board'].earnedAt, 4, 'a board that is gone does not count');
  // Defaults to today's boards.
  const def = badges({ monopoly: [monoWin(1, {}, 'classic')] });
  assert.ok(def['mono-every-board'].progress!.need >= 3);
});

test('Monopoly: Landlord and Mogul from the colour sets recorded at game end (older records have none)', () => {
  const old = badges({ monopoly: [monoWin(1)] });
  assert.equal(old['mono-landlord'].earned, false, 'no sets recorded: not earned');
  const b = badges({ monopoly: [monoLoss(1, { sets: 1 }), monoLoss(2, { sets: 2 }), monoWin(3, { sets: 3 })] });
  assert.equal(b['mono-landlord'].earnedAt, 1, 'a set held in a game you lost still counts');
  assert.equal(b['mono-mogul'].earnedAt, 3);
});

test('Monopoly and Cards: King of the Table and Circus Master need three or more opponents', () => {
  const small = badges({ monopoly: [mono(1, [human('ann'), bot('a'), bot('b')])], cards: [cards(2, [chuman('ann'), cbot('a'), cbot('b')])] });
  assert.equal(small['mono-crowd'].earned, false);
  assert.equal(small['cards-crowd'].earned, false);
  const big = badges({ monopoly: [mono(1, [human('ann'), bot('a'), bot('b'), bot('c')])], cards: [cards(2, [chuman('ann'), cbot('a'), cbot('b'), chuman('c')])] });
  assert.equal(big['mono-crowd'].earnedAt, 1);
  assert.equal(big['cards-crowd'].earnedAt, 2);
});

test(`Cards: Hand Grenade (${ACH.handGrenadeCards}+ cards left), Big Haul (${ACH.bigHaulPoints}+ points in a round), Long Game (a points match)`, () => {
  const near = badges({ cards: [cardsLoss(1, { roundCards: ACH.handGrenadeCards - 1, bestRound: ACH.bigHaulPoints - 1 }), cardsWin(2, {}, 'single')] });
  assert.equal(near['cards-hand-grenade'].earned, false);
  assert.equal(near['cards-big-haul'].earned, false);
  assert.equal(near['cards-long-game'].earned, false, 'a single round is not a points match');
  const b = badges({ cards: [cardsLoss(1, { roundCards: ACH.handGrenadeCards, bestRound: ACH.bigHaulPoints }), cardsWin(2, {}, 'points')] });
  assert.equal(b['cards-hand-grenade'].earnedAt, 1, 'a round won counts even in a match lost');
  assert.equal(b['cards-big-haul'].earnedAt, 1);
  assert.equal(b['cards-long-game'].earnedAt, 2);
});

test('bestRounds: the best round a player won, by points and by cards left in the others\' hands', () => {
  const history: CardsRoundResult[] = [
    { round: 1, winner: 'ann', points: 40, hands: { ben: 30, cy: 10 }, cards: { ben: 5, cy: 2 } },
    { round: 2, winner: 'ben', points: 300, hands: { ann: 300 }, cards: { ann: 20 } },
    { round: 3, winner: 'ann', points: 120, hands: { ben: 100, cy: 20 }, cards: { ben: 3, cy: 1 } },
    { round: 4, winner: 'ann', points: 10, hands: { ben: 10 } },
  ];
  assert.deepEqual(bestRounds(history, 'ann'), { bestRound: 120, roundCards: 7 });
  assert.deepEqual(bestRounds(history, 'ben'), { bestRound: 300, roundCards: 20 });
  assert.deepEqual(bestRounds(history, 'cy'), {}, 'won no round: nothing recorded');
  assert.deepEqual(bestRounds([{ round: 1, winner: 'cy', points: 9, hands: { ann: 9 } }], 'cy'), { bestRound: 9 }, 'older games kept no card counts');
});

test('tournaments: played, final table, podium and champion', () => {
  const b = badges({ tournaments: [tourney(30, 1, true), tourney(20, 3, true), tourney(10, 7)] });
  assert.equal(b['tourney-played'].earnedAt, 10);
  assert.equal(b['tourney-final'].earnedAt, 20);
  assert.equal(b['tourney-podium'].earnedAt, 20);
  assert.equal(b['tourney-champ'].earnedAt, 30);
  const early = badges({ tournaments: [tourney(10, 9)] });
  assert.equal(early['tourney-final'].earned, false);
  assert.equal(early['tourney-champ'].earned, false);
});

test('Chog holders: a linked wallet, playing as your own NFT Chog, winning as one', () => {
  const none = badges({ monopoly: [monoWin(1)] });
  assert.equal(none.wallet.earned, false);
  assert.equal(none['own-chog'].earned, false);
  const b = badges({ walletLinkedAt: 77, monopoly: [monoLoss(5, { chogToken: 12 })], cards: [cardsWin(9, { chogToken: 12 })] });
  assert.equal(b.wallet.earnedAt, 77);
  assert.equal(b['own-chog'].earnedAt, 5);
  assert.equal(b['own-chog-win'].earnedAt, 9);
});

test('order: earned badges newest first, then locked ones nearest to done', () => {
  const list = computeAchievements('ann', {
    monopoly: [monoWin(1), monoWin(2), monoWin(3)], cards: [cardsWin(50)], tournaments: [], walletLinkedAt: 10,
  });
  const earned = list.filter(a => a.earned);
  assert.ok(earned.every((a, i) => i === 0 || (earned[i - 1].earnedAt ?? 0) >= (a.earnedAt ?? 0)), 'newest first');
  assert.equal(list.findIndex(a => !a.earned), earned.length, 'all earned before any locked');
  assert.equal(list[0].earnedAt, 50);
  const locked = list.filter(a => !a.earned);
  // games-10 (4/10) ahead of a one-off badge with nothing to show yet.
  assert.ok(locked.findIndex(a => a.id === 'games-10') < locked.findIndex(a => a.id === 'mono-landlord'));
  assert.deepEqual(sortAchievements(list).map(a => a.id), list.map(a => a.id), 'stable');
});

test('gamesOf: both stores, one timeline, oldest first', () => {
  const g = gamesOf('ann', [monoWin(30), monoLoss(10)], [cardsWin(20)]);
  assert.deepEqual(g.map(x => [x.game, x.endedAt, x.won]), [['monopoly', 10, false], ['cards', 20, true], ['monopoly', 30, true]]);
});

test('engine: a colour set held whole is remembered in the player\'s stats, even after it is broken up', () => {
  const { g, act, dice } = scripted(2);
  // Brown is spaces 1 and 3 on the classic board.
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  g.owned[3] = { owner: 'p0', houses: 0, mortgaged: false };
  dice(3, 4);
  act('p0', { type: 'roll' });
  assert.deepEqual(g.stats.p0?.sets, ['brown']);
  g.owned[3].owner = 'p1';
  dice(1, 2);
  act('p0', { type: 'endTurn' });
  assert.deepEqual(g.stats.p0?.sets, ['brown'], 'once held, it counts');
  assert.equal(g.stats.p1?.sets, undefined);
});
