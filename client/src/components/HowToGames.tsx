// The short tutorials for the hub's other two games, shown by HowToPlay when it
// is opened for Cards or Poker (the "?" on their hub cards, the hero's game tabs,
// the Cards home). Six steps each (Cards adds a seventh for its Chog Chaos
// mode), quick to read. Keep them in step with:
//   Cards: server/src/cards/game.ts, shared/cards/rules.ts and deck.ts (points, the Chaos cards);
//   Poker: poker/client (tournaments only, "Your Chog", sign-in).
import type { ReactNode } from 'react';
import type { Card } from '../../../shared/cards/deck.ts';
import { CARDS_CHAOS_DECK_SIZE, CARDS_HAND_SIZE, CARDS_MERCY_LIMIT, LAST_CARD_CALL } from '../../../shared/cards/meta.ts';
import { CARDS_HOUSE_RULES, CARDS_MODES, DEFAULT_CARDS_RULES } from '../../../shared/cards/rules.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { CardFace } from '../cards/CardFace.tsx';

export interface GuideStep { icon: string; title: string; text: string; art?: ReactNode }

/** A row of real Cards faces, small, as a step's picture. */
function Fan({ cards, label }: { cards: Card[]; label: string }) {
  return (
    <div className="howto-art howto-fan" role="img" aria-label={label}>
      {cards.map(c => <CardFace key={c.id} card={c} />)}
    </div>
  );
}

/** A playing card as a small chip: "A♠". Hearts and diamonds in red. */
function Pc({ c }: { c: string }) {
  const red = c.endsWith('♥') || c.endsWith('♦');
  return <span className={`howto-pc${red ? ' red' : ''}`}>{c}</span>;
}
const pcs = (s: string) => s.split(' ').map((c, i) => <Pc key={i} c={c} />);

const target = DEFAULT_CARDS_RULES.targetScore;
const houseNames = CARDS_HOUSE_RULES.filter(h => h.key !== 'stacking').map(h => h.label);
const chaosName = CARDS_MODES.find(m => m.id === 'chaos')!.label;

export function cardsSteps(): GuideStep[] {
  return [
    {
      icon: '🎯', title: 'Match the top card',
      text: `Everyone starts with ${CARDS_HAND_SIZE} cards. On your turn play one that matches the top card's colour, number or symbol. Can't? Draw one, and if it fits you may play it straight away.`,
      art: <Fan label="A red 7 on a red 2, then a green 7 on the red 7" cards={[
        { id: 1, kind: 'number', color: 'red', value: 2 },
        { id: 2, kind: 'number', color: 'red', value: 7 },
        { id: 3, kind: 'number', color: 'green', value: 7 },
      ]} />,
    },
    {
      icon: '⚡️', title: 'Action cards',
      text: 'Skip hops the next player; Reverse turns play round. Draw Two: the next player draws 2 and misses a turn. Wilds go on anything and name the colour. A Wild Draw Four adds a draw of 4, but only when you hold nothing in the colour in play. Smell a bluff? Challenge: a bluffer draws the 4 instead, but if it was fair you draw 6.',
      art: <Fan label="Skip, Reverse, Draw Two, Wild and Wild Draw Four" cards={[
        { id: 11, kind: 'skip', color: 'yellow' },
        { id: 12, kind: 'reverse', color: 'green' },
        { id: 13, kind: 'draw2', color: 'blue' },
        { id: 14, kind: 'wild', color: null },
        { id: 15, kind: 'wild4', color: null },
      ]} />,
    },
    {
      icon: '📚', title: 'Stack it',
      text: 'Stacking is on unless the host turns it off. Hit by a Draw Two? Answer with your own Draw Two (a Draw Four on a Draw Four) and the penalty grows and moves on. Whoever can\'t stack draws the lot and misses a turn.',
    },
    {
      icon: '📣', title: `Call "${LAST_CARD_CALL}"`,
      text: `Down to one card? Hit "${LAST_CARD_CALL}" (you can as you play your second to last). Forget, and anyone can tap "Catch!" before the next player moves: you draw 2.`,
    },
    {
      icon: '🏆', title: 'Rounds & points',
      text: `First out of cards wins the round and scores what is left in everyone else's hands: numbers at face value, Skip, Reverse and Draw Two 20, Wilds 50. The host picks a single round or a match to a score (${target} unless they change it).`,
    },
    {
      icon: '🏠', title: 'House rules',
      text: `The host can mix it up before the deal: ${houseNames.join(', ')}. The Rules button at the table shows what is on.`,
    },
    {
      icon: '🌀', title: chaosName,
      text: `Classic is the default; the host can pick ${chaosName} instead: ${CARDS_CHAOS_DECK_SIZE} cards. Purge drops every card of its colour with it; Blitz skips everyone, so you go again. Gas Spike +6 and Rug Pull +10 are Wilds that hit the next player hard, and any Draw card stacks on a smaller one. Chog Roulette: the next player turns up cards until your colour shows and keeps them all. 7s swap hands, 0s pass them on, you draw until you can play, and ${CARDS_MERCY_LIMIT} cards knocks you out of the round.`,
      art: <Fan label="Purge, Blitz, Gas Spike +6, Rug Pull +10 and Chog Roulette" cards={[
        { id: 21, kind: 'purge', color: 'green' },
        { id: 22, kind: 'blitz', color: 'blue' },
        { id: 23, kind: 'wild6', color: null },
        { id: 24, kind: 'wild10', color: null },
        { id: 25, kind: 'roulette', color: null },
      ]} />,
    },
  ];
}

/** Best first, with an example of each. */
const RANKS: [string, string][] = [
  ['Royal flush', 'A♠ K♠ Q♠ J♠ 10♠'],
  ['Straight flush', '9♥ 8♥ 7♥ 6♥ 5♥'],
  ['Four of a kind', 'Q♣ Q♦ Q♥ Q♠'],
  ['Full house', 'K♠ K♥ K♦ 4♣ 4♠'],
  ['Flush', 'A♦ J♦ 8♦ 5♦ 2♦'],
  ['Straight', '8♣ 7♦ 6♠ 5♥ 4♣'],
  ['Three of a kind', '7♠ 7♥ 7♦'],
  ['Two pair', 'J♣ J♥ 3♠ 3♦'],
  ['Pair', '10♠ 10♥'],
  ['High card', 'A♣'],
];

export function pokerSteps(): GuideStep[] {
  return [
    {
      icon: '♠️', title: 'Your best five',
      text: 'No-Limit Hold\'em: you get two cards only you see, and five shared cards land face up in the middle. Your hand is the best five of those seven. Best to worst:',
      art: (
        <ol className="howto-art howto-ranks">
          {RANKS.map(([name, eg]) => <li key={name}><b>{name}</b><span>{pcs(eg)}</span></li>)}
        </ol>
      ),
    },
    {
      icon: '💬', title: 'Four betting rounds',
      text: 'Preflop (your two cards), the flop (three shared cards), the turn (a fourth), the river (the fifth). Each round: check, bet, call, raise or fold; no-limit means all in at any time. Make everyone fold, or show the best hand at the end, to win the pot.',
    },
    {
      icon: '⏫', title: 'The blinds go up',
      text: 'The small and big blind are forced bets that move round the table each hand. In a tournament they rise every level, with antes later, so stacks shrink and you have to play. Every decision is on a clock, plus a one-off time bank.',
    },
    {
      icon: '🏟️', title: 'Multi-table tournaments',
      text: 'Register in the lobby before the start, or during late registration. Everyone gets the same stack at 9-seat tables; as players bust, tables are balanced and broken down to one final table. Out of chips, you are out (unless re-entry is on). Last one standing wins; the top places share the prizes.',
    },
    {
      icon: '💜', title: 'Play as your Chog',
      text: `Hold a Chog Genesis? Link its wallet to your ${BRAND.name} account, then tap your avatar at the top of ${GAMES.poker.name} and pick it: your Chog sits at the table, in chat and in the results.`,
    },
    {
      icon: '🔑', title: `Your ${BRAND.name} account`,
      text: `${GAMES.poker.name} has its own site but the same account. Signed in here, Play ${GAMES.poker.name} takes you over signed in; over there, use "Sign in via ${BRAND.name}".`,
    },
  ];
}
