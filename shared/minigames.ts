// Mini-games: the protocol side. The server runs each game (server/src/engine/
// minigames/); this file holds what both ends must agree on — the moves a
// player can send and the view every client (players and spectators alike)
// receives. A view is broadcast to everyone, so it never carries hidden
// information: no next card, no answer, no "GO" time before it happens.

export type MinigameKind = 'diceDuel' | 'highLow' | 'reaction' | 'quickMath' | 'wheel';

export const MINIGAME_KINDS: MinigameKind[] = ['diceDuel', 'highLow', 'reaction', 'quickMath', 'wheel'];

export const MINIGAME_INFO: Record<MinigameKind, { title: string; icon: string; blurb: string }> = {
  diceDuel: { title: 'Dice Duel', icon: '🎲', blurb: 'Both roll two dice — the higher total wins. Ties split the prize. Too slow and the clock rolls for you.' },
  highLow: { title: 'High or Low', icon: '🃏', blurb: 'Will the next card be higher or lower? Aces are low, and an equal rank counts as right. Each right guess doubles the prize. Cash out any time; if time runs out, the pot is banked for you.' },
  reaction: { title: 'Reaction Race', icon: '⚡', blurb: 'Wait for GO, then tap first. Tap too early and you are out.' },
  quickMath: { title: 'Quick Math', icon: '🧮', blurb: 'First correct answer wins. One wrong answer and you are locked out.' },
  wheel: { title: 'Wheel Spin', icon: '🎡', blurb: 'Spin the wheel and take what it lands on. Too slow and the clock spins for you.' },
};

/** The one `minigame` action's payload. Which moves are legal depends on the game. */
export type MinigameMove =
  | { kind: 'roll' }                    // Dice Duel
  | { kind: 'higher' }                  // High or Low
  | { kind: 'lower' }
  | { kind: 'cashOut' }
  | { kind: 'tap' }                     // Reaction Race
  | { kind: 'answer'; value: number }   // Quick Math
  | { kind: 'spin' }                    // Wheel Spin
  | { kind: 'continue' };               // lander skips the result screen

/** What one player got out of a round. Negative amounts were paid to the bank. */
export interface MinigamePayout {
  player: string;
  amount: number;
  /** Won a Get Out of Jail Free card. */
  jailCard?: boolean;
}

export interface MinigameResult {
  headline: string;
  payouts: MinigamePayout[];
}

// ---- Wheel Spin -------------------------------------------------------------

export interface WheelSegment {
  label: string;
  /** Cash won (negative = paid to the bank / Free Parking pot). */
  amount: number;
  jailCard?: boolean;
  /** Relative chance of landing here. */
  weight: number;
  color: string;
}

/** Laid out clockwise from the pointer. Expected value ≈ +60 cash, plus the odd jail card. */
export const WHEEL_SEGMENTS: WheelSegment[] = [
  { label: '50', amount: 50, weight: 5, color: '#3cb4ff' },
  { label: 'LOSE 50', amount: -50, weight: 3, color: '#3a4152' },
  { label: '100', amount: 100, weight: 4, color: '#3ddc84' },
  { label: '25', amount: 25, weight: 5, color: '#b15cff' },
  { label: 'JAIL FREE', amount: 0, jailCard: true, weight: 2, color: '#ff8c1a' },
  { label: '150', amount: 150, weight: 3, color: '#ff5fa2' },
  { label: '75', amount: 75, weight: 4, color: '#00d6c2' },
  { label: 'JACKPOT 250', amount: 250, weight: 1, color: '#ffd23f' },
];

// ---- views ------------------------------------------------------------------

export interface MinigameViewBase {
  /** Unique per round, so clients can restart animations. */
  seq: number;
  /** The player who landed on the arcade. */
  host: string;
  /** Who may play this round. */
  players: string[];
  /** 'play' until the round is decided, then 'result' for a few seconds. */
  stage: 'play' | 'result';
  /** Server-clock deadline for the current stage; null while it is secret (Reaction Race). */
  endsAt: number | null;
  /**
   * Server-clock time play begins (stage 'play'): the server holds the round
   * until the move that landed here has played out, so clients keep the panel
   * out of the way until then. Absent from older servers.
   */
  startsAt?: number;
  result: MinigameResult | null;
}

/** The part of a view that differs per game. */
export type MinigameBody =
  | {
    kind: 'diceDuel';
    opponent: string;
    prize: number;
    rolls: Record<string, [number, number]>;
  }
  | {
    kind: 'highLow';
    /** Cards turned so far, 0–51 (rank = card % 13 + 1, ace low; suit = card / 13). The last is the live card. */
    cards: number[];
    /** Prize held right now. */
    prize: number;
    maxPrize: number;
    /** 'bust' after a wrong guess, 'cashed' when banked. */
    outcome: 'bust' | 'cashed' | null;
  }
  | {
    kind: 'reaction';
    /** GO has been shown. */
    go: boolean;
    prize: number;
    /** Tapped before GO. */
    early: string[];
    winner: string | null;
    /** Milliseconds from GO to the winning tap (server-measured). */
    winnerMs: number | null;
  }
  | {
    kind: 'quickMath';
    question: string;
    options: number[];
    prize: number;
    /** Answered wrong this round. */
    locked: string[];
    winner: string | null;
    /** Revealed only once the round is over. */
    answer: number | null;
  }
  | {
    kind: 'wheel';
    /** Index into WHEEL_SEGMENTS once spun. */
    segment: number | null;
  };

export type MinigameView = MinigameViewBase & MinigameBody;

export function cardRank(card: number): number {
  return (card % 13) + 1;
}

export function cardLabel(card: number): string {
  const r = cardRank(card);
  const face = r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
  return face + ['♠', '♥', '♦', '♣'][Math.floor(card / 13) % 4];
}
