// Table options. The defaults are the official rules: every house rule is off
// and a match runs to 500 points.

export type CardsMatchMode = 'single' | 'points';

export interface CardsRules {
  /** One round, or rounds until someone reaches targetScore. */
  match: CardsMatchMode;
  targetScore: number;
  /** Seconds per turn step for humans; 0 = no timer. On timeout: draw, then pass. */
  turnSeconds: number;
  /** Draw Two on Draw Two, Wild Draw Four on Wild Draw Four: the penalty grows and moves on. */
  stacking: boolean;
  /** With stacking: a Wild Draw Four on a Draw Two, or a Draw Two in the named colour on a Wild Draw Four. */
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
}

export const DEFAULT_CARDS_RULES: CardsRules = {
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
};

export type CardsHouseRule = 'stacking' | 'stackMixed' | 'sevenZero' | 'jumpIn' | 'drawUntilPlayable' | 'forcedPlay' | 'noBluff';

/** The house-rule switches, in the order a settings panel lists them. */
export const CARDS_HOUSE_RULES: { key: CardsHouseRule; label: string; help: string }[] = [
  { key: 'stacking', label: 'Stacking', help: 'Answer a Draw Two with a Draw Two (or a Draw Four with a Draw Four); the next player draws the lot.' },
  { key: 'stackMixed', label: 'Mixed stacking', help: 'With stacking, Draw Twos and Draw Fours stack on each other.' },
  { key: 'sevenZero', label: '7-0', help: 'A 7 swaps hands with a player you choose; a 0 passes every hand along.' },
  { key: 'jumpIn', label: 'Jump-in', help: 'Holding a card identical to the top card? Play it out of turn.' },
  { key: 'drawUntilPlayable', label: 'Draw until playable', help: 'Keep drawing until you get a card you can play.' },
  { key: 'forcedPlay', label: 'Forced play', help: 'A playable card you draw must be played.' },
  { key: 'noBluff', label: 'No bluffing', help: 'Wild Draw Four can always be played and cannot be challenged.' },
];

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
  };
}
