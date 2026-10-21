// Classic stays Classic. Chog Chaos (its deck, cards, Mercy and stacking by
// size) lives beside the official game, so a Classic table must play exactly
// as it did before the mode existed: the same 108 cards, the same rules, the
// same bot moves. These seeded all-bot games fingerprint every hand, score,
// round result and winner (and the log, bar the "Stacked!" line the combo
// counter added). The expected value was taken on the engine from before Chog
// Chaos; if a deliberate change to Classic moves it, re-run and update it in
// the same change, saying why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CardsGame } from '../src/cards/game.ts';
import { cardsBotAction } from '../src/cards/bot.ts';
import { buildDeck } from '../../shared/cards/deck.ts';
import { DEFAULT_CARDS_RULES } from '../../shared/cards/rules.ts';
import type { CardsBotLevel } from '../../shared/cards/types.ts';
import { seeded } from './cardsHelpers.ts';

const FLAGS = ['stacking', 'stackMixed', 'sevenZero', 'jumpIn', 'drawUntilPlayable', 'forcedPlay', 'noBluff'] as const;
const LEVELS: CardsBotLevel[] = ['easy', 'normal', 'hard'];
const GAMES = 60;
/** From the engine before Chog Chaos (commit 7bc9b61). */
const CLASSIC_FINGERPRINT = 'f18b1280800a4838284de297f53f918c9dd4447ea3ef58cd1c001aea91b8ac2c';

function playClassic(gi: number): CardsGame {
  const rules: Record<string, unknown> = { match: gi % 3 ? 'single' : 'points', targetScore: 200, turnSeconds: 0 };
  FLAGS.forEach((f, k) => { rules[f] = ((gi >> k) & 1) === 1; });
  let t = 0;
  const g = new CardsGame({
    players: Array.from({ length: 2 + (gi % 7) }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true, level: LEVELS[(gi + i) % 3] })),
    rules, rng: seeded(1000 + gi), now: () => t,
  });
  for (let k = 0; k < 4000 && g.phase !== 'over'; k++) {
    t += 3000;
    if (g.phase === 'roundOver') { g.startNextRound(); continue; }
    let moved = false;
    for (const p of g.players) {
      const a = cardsBotAction(g, p.id);
      if (!a) continue;
      try { g.apply(p.id, a); moved = true; break; } catch { /* another seat */ }
    }
    if (!moved) break;
  }
  return g;
}

test('Classic is the default: the official 108, no Mercy, stacking on as before', () => {
  assert.equal(DEFAULT_CARDS_RULES.mode, 'classic');
  assert.equal(DEFAULT_CARDS_RULES.mercy, false);
  assert.equal(DEFAULT_CARDS_RULES.stacking, true);
  assert.equal(DEFAULT_CARDS_RULES.stackMixed, false);
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.ok(deck.every(c => ['number', 'skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(c.kind)), 'no Chog Chaos card in Classic');
  assert.equal(new CardsGame({ players: [{ id: 'a', name: 'A', isBot: true }, { id: 'b', name: 'B', isBot: true }] }).deckSize, 108);
});

test(`Classic plays exactly as before Chog Chaos: ${GAMES} seeded bot games, every house-rule mix`, () => {
  const h = createHash('sha256');
  for (let gi = 0; gi < GAMES; gi++) {
    const g = playClassic(gi);
    assert.equal(g.phase, 'over', `game ${gi} finishes`);
    for (const p of g.players) assert.ok(!p.out, 'nobody is ever knocked out in Classic');
    h.update(JSON.stringify([
      // (Round card counts are bookkeeping for achievements, not play: left out of the fingerprint.)
      g.players.map(p => [p.hand, p.score]), g.winner, g.history.map(({ cards: _cards, ...h }) => h),
      g.log.map(e => e.text).filter(t => !t.startsWith('🔥 Stacked!')).slice(-120),
    ]));
  }
  assert.equal(h.digest('hex'), CLASSIC_FINGERPRINT);
});
