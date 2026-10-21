// Protocol types for the card game: what a client may send, and what each
// viewer is shown. A view is built for one viewer and holds nothing that
// viewer could not see at a real table (see CardsGame.view).

import type { Card, CardColor, CardKind } from './deck.ts';
import type { CardsRules } from './rules.ts';

export type CardsBotLevel = 'easy' | 'normal' | 'hard';

export type CardsPhase =
  | 'play'      // current player plays, draws, or (facing a Draw card) stacks / takes it / challenges
  | 'drawn'     // current player drew a playable card: play it or pass
  | 'color'     // current player names the colour for a Wild (or the Wild turned up to start the round)
  | 'swap'      // 7-0: current player picks whose hand to swap with
  | 'roundOver' // a short break before the next deal (nextRoundAt)
  | 'over';     // the match is decided

/** Play direction: 1 = up the seat order ("clockwise"), -1 = down it. */
export type CardsDirection = 1 | -1;

export type CardsAction =
  /**
   * Play a card from hand. In turn: it must match (or stack on a pending
   * Draw). Out of turn with the jump-in rule: an identical card. `color` names
   * a Wild's colour and `target` picks a 7's swap partner; leave them out to
   * be asked (phase 'color' / 'swap'). `callLastCard` says "Last card!" with
   * the play (only counts when the play leaves one card).
   */
  | { type: 'play'; card: number; color?: CardColor; target?: string; callLastCard?: boolean }
  /** Draw a card (or, facing a Draw Two / Draw Four, take the penalty). */
  | { type: 'draw' }
  /** Keep the playable card just drawn and end the turn. */
  | { type: 'pass' }
  | { type: 'chooseColor'; color: CardColor }
  | { type: 'swap'; target: string }
  /** Challenge the Wild Draw Four just played on you. */
  | { type: 'challenge' }
  /** "Last card!" — with one card left, or with two just before playing one. */
  | { type: 'callLastCard' }
  /** Catch a player who went down to one card without calling. */
  | { type: 'catch'; target: string };

export type CardsDrawReason =
  | 'turn'       // an ordinary draw
  | 'penalty'    // took a Draw Two / Draw Four (stacked or not)
  | 'start'      // a Draw Two turned up to start the round
  | 'bluff'      // a challenged Wild Draw Four was illegal: its player draws 4
  | 'challenge'  // a failed challenge: the challenger draws 6
  | 'caught';    // caught without calling "Last card!": draw 2

/**
 * One thing that happened, in order. A CardsPlay is a list of these; the
 * client stages them as animations (deal, flip, fly a card, fan out a draw,
 * spin the direction arrow, ...).
 */
export type CardsStep =
  | { type: 'deal'; round: number; dealer: string; order: string[]; count: number }
  /** The start card turned up. `back`: a Wild Draw Four, shuffled back in before the next flip. */
  | { type: 'flip'; card: Card; back?: boolean }
  /** `from`: out of the hand, or the card just drawn. */
  | { type: 'play'; player: string; card: Card; from: 'hand' | 'drawn'; jumpIn?: boolean }
  /** `cards` is present only in the drawer's own view (and is the cards that reached the hand). */
  | { type: 'draw'; player: string; count: number; reason: CardsDrawReason; cards?: Card[] }
  | { type: 'reshuffle'; count: number }
  | { type: 'skip'; player: string }
  | { type: 'reverse'; direction: CardsDirection }
  | { type: 'color'; player: string; color: CardColor }
  | { type: 'swap'; player: string; target: string }
  /** 7-0: every hand moved one seat on in `direction`. */
  | { type: 'rotate'; direction: CardsDirection }
  /** `hand` (the challenged player's hand) is present only in the challenger's view. */
  | { type: 'challenge'; player: string; target: string; bluff: boolean; hand?: Card[] }
  | { type: 'call'; player: string }
  | { type: 'catch'; player: string; target: string }
  | { type: 'pass'; player: string }
  | { type: 'timeout'; player: string }
  | { type: 'leave'; player: string }
  /** Nobody could play or draw: `blocked` rounds go to the lowest hand. */
  | { type: 'roundEnd'; winner: string; points: number; blocked?: boolean; matchOver: boolean };

/** What the last action did. `seq` bumps on every action (and on each deal and timeout). */
export interface CardsPlay {
  seq: number;
  /** Who acted (the dealer for a deal; the timed-out player for a timeout). */
  player: string;
  steps: CardsStep[];
}

export interface CardsLogEntry {
  t: number;
  text: string;
  /** The player the line is about, for colouring. */
  who?: string;
  /** Cards drawn, or points scored. */
  amount?: number;
  reason?: CardsDrawReason | 'score';
  /** The CardsPlay.seq this line came with, so it can be shown once that play has animated. */
  play?: number;
}

/** A penalty waiting on the current player: stack on it, take it, or (a lone Wild Draw Four) challenge it. */
export interface CardsPendingDraw {
  amount: number;
  /** The Draw card on top (what a stack must answer). */
  kind: Extract<CardKind, 'draw2' | 'wild4'>;
  /** Who played the top Draw card. */
  from: string;
  /** The current player may challenge it (an unstacked Wild Draw Four, bluffing allowed). */
  challengeable: boolean;
  /** The colour in play before that Wild Draw Four (what its legality was judged on). */
  prevColor?: CardColor;
}

/** A player sitting on one card. Public: everyone at a table can see it. */
export interface CardsOneCard {
  player: string;
  /** When they went down to one card. */
  since: number;
  /** When they called "Last card!" (null: not yet). */
  calledAt: number | null;
  /** When the window closed uncalled because someone else acted (null: still open, or called). */
  closedAt: number | null;
  /** Still open to a catch: not called, and the next player has not acted yet. */
  catchable: boolean;
  /** A catch counts from this moment (a short grace to call first). */
  catchFrom: number;
}

export interface CardsPlayerView {
  id: string;
  name: string;
  isBot: boolean;
  /** Seat order (play order when direction is 1). */
  seat: number;
  /** Hand size only: nobody sees another player's cards. */
  cards: number;
  score: number;
  /** Timed out twice in a row: autopilot plays for them until they act again. */
  afk?: boolean;
  /** Left the table: skipped from now on. */
  left?: boolean;
}

/** The viewer's own seat. Absent for spectators. */
export interface CardsYouView {
  id: string;
  hand: Card[];
  /** Ids of cards the viewer may play right now (in turn, or a jump-in out of turn). */
  playable: number[];
  /** Phase 'drawn': the card just drawn (the only one that may be played). */
  drawn: number | null;
  canDraw: boolean;
  canPass: boolean;
  canChallenge: boolean;
  canCallLastCard: boolean;
  /** Players the viewer could catch right now. */
  canCatch: string[];
  /** Called "Last card!" ahead of playing down to one card. */
  preCalled: boolean;
}

export interface CardsRoundResult {
  round: number;
  winner: string;
  points: number;
  blocked?: boolean;
  /** Each loser's hand value at the end of the round. */
  hands: Record<string, number>;
  /** Each loser's number of cards at the end of the round (achievements); absent in older games. */
  cards?: Record<string, number>;
}

export interface CardsView {
  game: 'cards';
  rules: CardsRules;
  players: CardsPlayerView[];
  you: CardsYouView | null;
  phase: CardsPhase;
  current: string;
  dealer: string;
  direction: CardsDirection;
  /** The colour in play (null only while the round's first Wild waits for one). */
  color: CardColor | null;
  top: Card | null;
  discardCount: number;
  drawCount: number;
  pendingDraw: CardsPendingDraw | null;
  oneCard: CardsOneCard[];
  round: number;
  /** Turns taken this round (bumps whenever the turn moves on). */
  turn: number;
  history: CardsRoundResult[];
  /** The match winner (phase 'over'). */
  winner: string | null;
  lastPlay: CardsPlay | null;
  /** Bumps on every change, for clients that diff views. */
  seq: number;
  log: CardsLogEntry[];
  /** Deadline for the current player's step (turn timer), null = none. */
  turnEndsAt: number | null;
  /** Phase 'roundOver': when the next round is dealt. */
  nextRoundAt: number | null;
  paused: { by: string; at: number } | null;
  startedAt: number;
  endedAt: number | null;
}
