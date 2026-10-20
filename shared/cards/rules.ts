// Table options. The defaults are the official game with stacking on (how
// most people play): every other house rule is off and a match runs to 500
// points. A mode picks the deck (Classic, or Chog Chaos with its extra cards)
// and comes with its own set of house rules, which the host may still change.

import type { CardsDeckKind } from './deck.ts';

export type CardsMatchMode = 'single' | 'points';
export type CardsGameMode = CardsDeckKind;

export interface CardsRules {
  /** Classic, or Chog Chaos (its extra cards; with mixed stacking a Draw card goes on any of equal or lower value). */
  mode: CardsGameMode;
  /** One round, or rounds until someone reaches targetScore. */
  match: CardsMatchMode;
  targetScore: number;
  /** Seconds per turn step for humans; 0 = no timer. On timeout: draw, then pass. */
  turnSeconds: number;
  /** Draw Two on Draw Two, Wild Draw Four on Wild Draw Four: the penalty grows and moves on. */
  stacking: boolean;
  /**
   * With stacking: a Wild Draw Four on a Draw Two, or a Draw Two in the named
   * colour on a Wild Draw Four. In Chog Chaos: any Draw card on one of equal or
   * lower value (+2, +4, +6, +10), never a smaller one on a bigger one.
   */
  stackMixed: boolean;
  /** A 7 swaps hands with a chosen player; a 0 passes every hand on in the direction of play. */
  sevenZero: boolean;
  /** Play a card identical to the top card out of turn; play carries on from you. */
  jumpIn: boolean;
  /** Drawing keeps going until a playable card turns up. */
  drawUntilPlayable: boolean;
  /** A playable card you draw must be played. */
  forcedPlay: boolean;
  /** Wild Draw Four is always legal and cannot be challenged. */
  noBluff: boolean;
  /** A player who reaches CARDS_MERCY_LIMIT cards is knocked out of the round; the last one standing wins it. */
  mercy: boolean;
}

export const DEFAULT_CARDS_RULES: CardsRules = {
  mode: 'classic',
  match: 'points',
  targetScore: 500,
  turnSeconds: 30,
  stacking: true,
  stackMixed: false,
  sevenZero: false,
  jumpIn: false,
  drawUntilPlayable: false,
  forcedPlay: false,
  noBluff: false,
  mercy: false,
};

export type CardsHouseRule = 'stacking' | 'stackMixed' | 'sevenZero' | 'jumpIn' | 'drawUntilPlayable' | 'forcedPlay' | 'noBluff' | 'mercy';

/** The house-rule switches, in the order a settings panel lists them. */
export const CARDS_HOUSE_RULES: { key: CardsHouseRule; label: string; help: string }[] = [
  { key: 'stacking', label: 'Stacking', help: 'Answer a Draw Two with a Draw Two (or a Draw Four with a Draw Four); the next player draws the lot.' },
  { key: 'stackMixed', label: 'Mixed stacking', help: 'With stacking, Draw cards of different sizes stack on each other.' },
  { key: 'sevenZero', label: '7-0', help: 'A 7 swaps hands with a player you choose; a 0 passes every hand along.' },
  { key: 'jumpIn', label: 'Jump-in', help: 'Holding a card identical to the top card? Play it out of turn.' },
  { key: 'drawUntilPlayable', label: 'Draw until playable', help: 'Keep drawing until you get a card you can play.' },
  { key: 'forcedPlay', label: 'Forced play', help: 'A playable card you draw must be played.' },
  { key: 'noBluff', label: 'No bluffing', help: 'Wild Draw Four can always be played and cannot be challenged.' },
  { key: 'mercy', label: 'Mercy', help: 'Hold 25 cards and you are knocked out of the round. Last one standing wins it.' },
];

/** The modes, in the order a picker shows them, with the house rules each one switches to. */
export const CARDS_MODES: { id: CardsGameMode; label: string; tag: string; help: string; preset: Pick<CardsRules, CardsHouseRule> }[] = [
  {
    id: 'classic', label: 'Classic', tag: '108 cards',
    help: 'The game everyone knows: Skips, Reverses, Draw Twos and Wilds.',
    preset: { stacking: true, stackMixed: false, sevenZero: false, jumpIn: false, drawUntilPlayable: false, forcedPlay: false, noBluff: false, mercy: false },
  },
  {
    id: 'chaos', label: 'Chog Chaos', tag: '135 cards · no mercy',
    help: 'Purge, Blitz, Gas Spike +6, Rug Pull +10 and Chog Roulette. Every draw card stacks on a smaller one, 7s swap and 0s pass, you draw until you can play, and 25 cards knocks you out.',
    preset: { stacking: true, stackMixed: true, sevenZero: true, jumpIn: false, drawUntilPlayable: true, forcedPlay: false, noBluff: false, mercy: true },
  },
];

export function modeLabel(mode: CardsGameMode): string {
  return CARDS_MODES.find(m => m.id === mode)?.label ?? 'Classic';
}

export const TARGET_SCORE_MIN = 50;
export const TARGET_SCORE_MAX = 5000;
export const CARDS_TURN_SECONDS_MAX = 300;

/** Rules from a client: unknown fields dropped, bad values replaced by the defaults, numbers clamped. */
export function normalizeCardsRules(raw: unknown): CardsRules {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const flag = (k: CardsHouseRule) => (typeof r[k] === 'boolean' ? r[k] as boolean : DEFAULT_CARDS_RULES[k]);
  const int = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  const turn = int(r.turnSeconds, DEFAULT_CARDS_RULES.turnSeconds, 0, CARDS_TURN_SECONDS_MAX);
  return {
    mode: r.mode === 'chaos' ? 'chaos' : 'classic',
    match: r.match === 'single' || r.match === 'points' ? r.match : DEFAULT_CARDS_RULES.match,
    targetScore: int(r.targetScore, DEFAULT_CARDS_RULES.targetScore, TARGET_SCORE_MIN, TARGET_SCORE_MAX),
    // A few seconds is no time at all: anything under 10 (but not 0, "off") becomes 10.
    turnSeconds: turn === 0 ? 0 : Math.max(10, turn),
    stacking: flag('stacking'),
    stackMixed: flag('stackMixed'),
    sevenZero: flag('sevenZero'),
    jumpIn: flag('jumpIn'),
    drawUntilPlayable: flag('drawUntilPlayable'),
    forcedPlay: flag('forcedPlay'),
    noBluff: flag('noBluff'),
    mercy: flag('mercy'),
  };
}
